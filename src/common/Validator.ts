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
               });
               resolve();
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
                let miner = block.author;
                let blockBalanceChanges: any = {'earned': {}, 'spent': {}, 'tx_earned': {}, 'tx_spent': {}};
                let uncleBlocks = block.uncles.length;
                let uncleReward = 0.625;
                let maxUncles = 2;

                if (uncleBlocks > maxUncles) {
                    throw "More than 2 uncles in " + block.number;
                }

                let miningReward = blockReward + (uncleBlocks * (blockReward / 32));
                if (!(miner in blockBalanceChanges['earned'])) {
                    blockBalanceChanges['earned'][miner] = Config.web3.utils.toBN(Config.web3.utils.toWei(miningReward.toString()));
                } else {
                    blockBalanceChanges['earned'][miner] = blockBalanceChanges['earned'][miner].add(Config.web3.utils.toBN(Config.web3.utils.toWei(miningReward.toString())));
                }

                if (uncleBlocks > 0) {
                    let unclePromises = block.uncles.map((uncleHash: any, index: any) => {
                        return new Promise((resolve, reject) => {
                            Config.web3.eth.getUncle(block.number, index, false, (error:any, uncleBlock: any) => {
                                resolve(uncleBlock);
                            });
                        });
                    });

                    Promise.all(unclePromises).then((uncleBlocks) => {
                        uncleBlocks.forEach((uncleBlock: any) => {
                            const distance = currentBlockNumber - uncleBlock.number;
                            const multiplier = 8 - distance;
                            if (multiplier < 1) {
                                throw "Uncle " + uncleBlock.number + " too far from main " + currentBlockNumber;
                            }
                            if (multiplier > 7) {
                                throw "Uncle " + uncleBlock.number + " too close to main " + currentBlockNumber;
                            }
                            const uncleMinerReward = multiplier * uncleReward;
                            const uncleMiner = uncleBlock.author;

                            if (uncleMinerReward != 0) {
                                if (!(uncleMiner in blockBalanceChanges['earned'])) {
                                    blockBalanceChanges['earned'][uncleMiner] = Config.web3.utils.toBN(Config.web3.utils.toWei(uncleMinerReward.toString()));
                                } else {
                                    blockBalanceChanges['earned'][uncleMiner] = blockBalanceChanges['earned'][uncleMiner].add(Config.web3.utils.toBN(Config.web3.utils.toWei(uncleMinerReward.toString())));
                                }
                            }
                        });

                        self.getBalanceStateChanges(resolve, reject, block, blockBalanceChanges);
                    });
                } else {
                    self.getBalanceStateChanges(resolve, reject, block, blockBalanceChanges);
                }
            });
        });
    }

    getBalanceStateChanges(resolve:any, reject:any, block:any, blockBalanceChanges:any) {
        Config.web3.getBlockStateChanges('0x' + block.number.toString(16), ["stateDiff"], (err: Error, stateChanges: any) => {
            if (err) reject(err);
            stateChanges.forEach((stateChange: any) => {
                stateChange.forEach((change: any) => {
                    if (change.delta > 0)
                    {
                        if (!(change.address in blockBalanceChanges['earned'])) {
                            blockBalanceChanges['earned'][change.address] = change.delta
                        } else {
                            blockBalanceChanges['earned'][change.address] = blockBalanceChanges['earned'][change.address].add(change.delta);
                        }
                    }
                    else if (change.delta < 0)
                    {
                        if (!(change.address in blockBalanceChanges['spent'])) {
                            blockBalanceChanges['spent'][change.address] = change.delta
                        } else {
                            blockBalanceChanges['spent'][change.address] = blockBalanceChanges['spent'][change.address].add(change.delta);
                        }
                    }
                });
            });
            resolve({block: block.number, changes: blockBalanceChanges});
        });
    }

    validateType(timestamp: any, balances : any, actionType: any)
    {
        let ts = timestamp;
        const self = this;

        return new Promise((resolve, reject) => {
            Object.keys(balances[actionType]).forEach((address) => {
                if (!(address in this.addresses)) {
                    self.connection.beginTransaction(function (err: any) {
                        if (err) {
                            throw err;
                        }
                        self.connection.query("lock tables addresses write", function(error: any, results: any, fields: any) {
                            if (err) {
                                throw err;
                            }
                            self.connection.query("select id from addresses where address=? for update", [address], function (error: any, results: any, fields: any) {
                                if (error) {
                                    throw error;
                                }
                                if (results.length === 0) {
                                    self.connection.query("insert into addresses set address=?", address, function (error: any, results: any, fields: any) {
                                        if (error) {
                                            throw error;
                                        }
                                        self.connection.query("unlock tables", function(error: any, results: any, fields: any) {
                                            if (err) {
                                                throw err;
                                            }
                                            self.connection.commit(function (error: any) {
                                                if (error) {
                                                    self.connection.rollback(function () {
                                                        throw err;
                                                    });
                                                }
                                                self.addresses[address] = results.insertId;
                                                self.validateBalances(ts, balances[actionType][address], results.insertId, actionType);
                                                resolve();
                                                return;
                                            });
                                        });
                                    });
                                } else {
                                    self.connection.query("unlock tables", function(error: any, results: any, fields: any) {
                                        if (err) {
                                            throw err;
                                        }
                                        self.connection.commit(function (error: any) {
                                            if (error) {
                                                self.connection.rollback(function () {
                                                    throw err;
                                                });
                                            }
                                            self.validateBalances(ts, balances[actionType][address], results[0].id, actionType);
                                            resolve();
                                            return;
                                        });
                                    });
                                }
                            });
                        });
                    });
                } else {
                    self.validateBalances(ts, balances[actionType][address], self.addresses[address], actionType);
                    resolve();
                    return;
                }
            });
            resolve();
        });
    }

    validate(timestamp : any, balances: any) {
        const self = this;
        return new Promise((resolve, reject) => {
            let earnedP = self.validateType(timestamp, balances, 'earned');
            let spentP = self.validateType(timestamp, balances, 'spent');
            Promise.all([earnedP, spentP]).then(() => {
               resolve();
            });
        });
    }

    private validateBalances(timestamp:any, balance:any, address_id:any, actionType: any)
    {
        let self = this;
        let earned = (actionType === "earned");
        if (this.shouldVerify) {
            self.connection.query("select delta from balances where balance_date = ? and address_id = ? and earned = ? for update", [timestamp, address_id, earned], function (error: any, results: any, fields: any) {
                if (error) throw error;
                if (results.length === 0) {
                    console.log("Balance not found for " + address_id + " on " + timestamp);
                    self.connection.query("replace into balances (balance_date, address_id, earned, delta) values (?, ?, ?, ?)", [timestamp, address_id, earned, balance.toString()], function (error: any, results: any, fields: any) {
                        if (error) throw error;
                    });
                } else {
                    if (results[0].delta !== balance.toString()) {
                        console.log("Balance not a match for " + address_id + " on " + timestamp);
                        self.connection.query("replace into balances (balance_date, address_id, earned, delta) values (?, ?, ?, ?)", [timestamp, address_id, earned, balance.toString()], function (error: any, results: any, fields: any) {
                            if (error) throw error;
                        });
                    }
                }
            });
        } else {
            self.connection.query("replace into balances (balance_date, address_id, earned, delta) values (?, ?, ?, ?)", [timestamp, address_id, earned, balance.toString()], function (error: any, results: any, fields: any) {
                if (error) throw error;
            });
        }
    }
}
