import { setDelay } from "./Utils";
import { Config } from "./Config";
import moment = require("moment");
import * as Bluebird from "bluebird";

const config = require("config");

export class Validator {
    private connection : any;
    private addresses : any;
    private shouldVerify : boolean;

    constructor(connection:any, shouldVerify:boolean) {
        this.shouldVerify = shouldVerify;
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
                    resolve({status: "done", block: block.number});
                    return;
                }

                let proms = self.process(block);
                if (proms.length > 0) {
                    Promise.all(proms).then((rawStateChanges) => {
                        //self.process(block).then((rawStateChanges: any) => {
                        let blockBalanceChanges: any = {};
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
                } else {
                    resolve({block: block.number, changes: {}});
                }
            });
        });
    }

    validate(timestamp : any, balances: any) {
        const self = this;
        let ts = timestamp;
        return new Promise((resolve, reject) => {
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
        });
    }

    private validateBalances(timestamp:any, balance:any, address_id:any)
    {
        const self = this;
        if (this.shouldVerify) {
            self.connection.query("select delta from balances where balance_date = ? and address_id = ?", [timestamp, address_id], function (error: any, results: any, fields: any) {
                if (error) throw error;
                if (results.length === 0) {
                    console.log("Balance not found for " + address_id + " on " + timestamp);
                } else {
                    if (results[0].delta !== balance.toString()) {
                        console.log("Balance not a match for " + address_id + " on " + timestamp);
                    } else {
                        //console.log("Balance matches for " + address_id + " on " + timestamp);
                    }
                }
                self.connection.query("replace into balances (balance_date, address_id, delta) values (?, ?, ?)", [timestamp, address_id, balance.toString()], function (error: any, results: any, fields: any) {
                    if (error) throw error;
                });
            });
        } else {
            self.connection.query("replace into balances (balance_date, address_id, delta) values (?, ?, ?)", [timestamp, address_id, balance.toString()], function (error: any, results: any, fields: any) {
                if (error) throw error;
            });
        }
    }

    private process(block: any) {
        const transactions = block.transactions;
        let endOfDay = moment.unix(block.timestamp).utc().endOf('day').unix();
        if (transactions.length === 0) return [];

        return transactions.map((tx:any) => {
            let thisT = tx;
            return new Promise((resolve, reject) => {
                Config.web3.getBalanceStateChanges(thisT.hash, ["stateDiff"], (err: Error, stateChange: any) => {
                    if (err) reject (err);
                    if (!stateChange) {
                        resolve(null);
                        return;
                    }
                    resolve({changes: stateChange, timestamp: endOfDay});
                });
            });
        });
    }
}
