import { Config } from "./Config";
import moment = require("moment");
import {min} from "moment";

export class Validator {
    private connection : any;
    private readonly addresses : any;
    readonly shouldVerify : boolean;

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
                let endOfDay = moment.unix(block.timestamp).utc().endOf('day').unix();

                if (endOfDay > currentDayTimestamp) {
                    resolve({status: "done", block: block.number});
                    return;
                }

                let blockReward = 5;
                let uncleReward = 3.75;
                let maxUncles = 2;
                let uncleBlocks = block.uncles.length;
                if (uncleBlocks > maxUncles) uncleBlocks = maxUncles;
                let miner = block.author;
                let blockBalanceChanges: any = {};
                let miningReward = blockReward + (uncleBlocks * (blockReward / 32)) + (uncleBlocks * uncleReward);
                blockBalanceChanges[miner] = Config.web3.utils.toBN(Config.web3.utils.toWei(miningReward.toString()));

                Config.web3.getBlockStateChanges('0x' + block.number.toString(16), ["stateDiff"], (err: Error, stateChanges: any) => {
                    if (err) reject (err);
                    stateChanges.forEach((stateChange:any) => {
                        stateChange.forEach((change: any) => {
                            if (change.delta != 0) {
                                if (!(change.address in blockBalanceChanges)) {
                                    blockBalanceChanges[change.address] = Config.web3.utils.toBN(0);
                                }
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
        return new Promise((resolve, reject) => {
            if (Object.keys(balances).length === 0) { resolve(); }
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
                                        self.addresses[address] = results.insertId;
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
                    self.connection.query("replace into balances (balance_date, address_id, delta) values (?, ?, ?)", [timestamp, address_id, balance.toString()], function (error: any, results: any, fields: any) {
                        if (error) throw error;
                    });
                } else {
                    if (results[0].delta !== balance.toString()) {
                        console.log("Balance not a match for " + address_id + " on " + timestamp);
                        self.connection.query("replace into balances (balance_date, address_id, delta) values (?, ?, ?)", [timestamp, address_id, balance.toString()], function (error: any, results: any, fields: any) {
                            if (error) throw error;
                        });
                    }
                }
            });
        } else {
            self.connection.query("replace into balances (balance_date, address_id, delta) values (?, ?, ?)", [timestamp, address_id, balance.toString()], function (error: any, results: any, fields: any) {
                if (error) throw error;
            });
        }
    }
}
