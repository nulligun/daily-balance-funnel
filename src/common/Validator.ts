import { setDelay } from "./Utils";
import { Config } from "./Config";
import moment = require("moment");
import * as Bluebird from "bluebird";

const config = require("config");

export class Validator {
    private connection : any;
    private addresses : any;

    constructor(connection:any) {
        this.connection = connection;
        this.addresses = {};
    }

    loadAddresses() {
        let self = this;
        return new Promise((resolve, reject) => {
            self.connection.query("select * from addresses", function (error: any, results: any, fields: any) {
               results.forEach((result:any) => {
                   self.addresses[result.address] = result.id;
                   resolve();
               });
            });
        });
    }

    next(currentBlockNumber : any, currentDayTimestamp : any): any {
        const self = this;

        return new Promise((resolve, reject) => {
            Config.web3.eth.getBlock(currentBlockNumber, true, function (error: any, result: any) {
                const block = result;

                const m = moment.unix(block.timestamp).utc().endOf('day');

                if (m.unix() > currentDayTimestamp) {
                    resolve({status: "done"});
                }

                self.process(block).then((rawStateChanges: any) => {
                    let blockBalanceChanges:any = {};
                    rawStateChanges.forEach((rawStateChange: any) => {
                        rawStateChange.changes.forEach((change: any) => {
                            if (!(change.address in blockBalanceChanges)) {
                                blockBalanceChanges[change.address] = Config.web3.utils.toBN(0);
                            }

                            if (change.delta != 0) {
                                blockBalanceChanges[change.address] = blockBalanceChanges[change.address].add(change.delta);
                            }
                        });
                    });
                    resolve({block: block.number, changes: blockBalanceChanges});
                });
            });
        });
    }

    validate(timestamp : any, balances: any) {
        const self = this;
        let ts = timestamp;
        new Promise((resolve, reject) => {
            Object.keys(balances).forEach((address) => {
                if (!(address in this.addresses))
                {
                    self.connection.beginTransaction(function(err:any) {
                        if (err) {
                            throw err;
                        }
                        self.connection.query("select id from addresses where address=?", [address], function (error:any, results:any, fields:any) {
                            if (error) {
                                throw error;
                            }
                            if (results.length === 0)
                            {
                                self.connection.query("insert into addresses set address=?", address, function(error:any, results:any, fields:any) {
                                    if (error) {
                                        throw error;
                                    }

                                    self.connection.commit(function(error:any) {
                                        if (error) {
                                            self.connection.rollback(function () {
                                                throw err;
                                            });
                                        }
                                        this.addresses[address] = results.insertId;
                                        self.validateBalances(ts, balances[address], results.insertId);
                                        resolve();
                                    });
                                });
                            } else {
                                self.connection.commit(function (error: any) {
                                    if (error) {
                                        self.connection.rollback(function () {
                                            throw err;
                                        });
                                    }
                                    self.validateBalances(ts, balances[address], results[0].id);
                                    resolve();
                                });
                            }
                        });
                    });
                } else {
                    self.validateBalances(ts, balances[address], self.addresses[address]);
                    resolve();
                }
            });
        }).then((result) => {

        });
    }

    private validateBalances(timestamp:any, balance:any, address_id:any)
    {
        const self = this;
        self.connection.beginTransaction((error:any) => {
            if (error) throw error;
            self.connection.query("select delta from balances where balance_date = ? and address_id = ?", [timestamp, address_id], function (error: any, results: any, fields: any) {
                if (error) throw error;
                if (results.length === 0) {
                    console.log("Balance not found for " + address_id + " on " + timestamp);
                    self.connection.query("replace into balances (balance_date, address_id, delta) values (?, ?, ?)", [timestamp, address_id, balance], function (error: any, results: any, fields: any) {
                        if (error) throw error;
                        self.connection.commit((error: any) => {
                            if (error) throw error;
                        });
                    });
                } else {
                    if (results[0].delta !== balance.toString()) {
                        console.log("Balance not a match for " + address_id + " on " + timestamp);
                        self.connection.query("replace into balances (balance_date, address_id, delta) values (?, ?, ?)", [timestamp, address_id, balance], function (error: any, results: any, fields: any) {
                            if (error) throw error;
                            self.connection.commit((error: any) => {
                                if (error) throw error;
                            });
                        });
                    } else {
                        console.log("Balance matches for " + address_id + " on " + timestamp);
                        self.connection.commit((error: any) => {
                            if (error) throw error;
                        });
                    }
                }
            });
        });
    }

    private async process (block: any) {
        const transactions = block.transactions;
        const b = block;
        let endOfDay = moment.unix(block.timestamp).utc().endOf('day').unix();
        if (transactions.length === 0) return [];
        const batchLimit = 300;
        const chunk = (list:any, size:any) => list.reduce((r:any, v:any) =>
            (!r.length || r[r.length - 1].length === size ?
                r.push([v]) : r[r.length - 1].push(v)) && r
            , []);
        const chunkTransactions = chunk(transactions, batchLimit);

        try {
            const stateChanges = await Bluebird.map(chunkTransactions, (chunk: any) => {
                return new Promise((resolve, reject) => {
                    let completed = false;
                    const chunkStateChanges:any[] = [];

                    if (chunk.length > 0) {
                        const batch = new Config.web3.BatchRequest();
                        chunk.forEach((tx: any) => {
                            batch.add(Config.web3.getBalanceStateChanges.request(tx.hash, ["stateDiff"], (err: Error, stateChange: any) => {
                                if (completed) return;
                                if (!stateChange || err) {
                                    completed = true;
                                    reject(err);
                                }
                                const taggedStateChange = {changes: stateChange, timestamp: endOfDay};
                                chunkStateChanges.push(err ? null : taggedStateChange);
                                if (chunkStateChanges.length >= chunk.length) {
                                    completed = true;
                                    resolve(chunkStateChanges);
                                }
                            }));
                        });
                        batch.execute();
                    } else {
                        resolve(chunkStateChanges);
                    }
                });
            });
            return [].concat(...stateChanges)
        } catch (error) {
            console.log('Error getting transaction state changes ', error)
            Promise.reject(error)
        }
    }
}
