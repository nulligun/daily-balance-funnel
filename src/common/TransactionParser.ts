import * as winston from "winston";
import { Config } from "./Config";
import moment = require("moment");
import Bluebird = require("bluebird");
const config = require("config");
const mysql = require('mysql');

export class TransactionParser {
    private  connection : any;

    constructor() {
        this.connection = mysql.createConnection({
            host     : config.get("MYSQL_HOST"),
            user     : config.get("MYSQL_USER"),
            password : config.get("MYSQL_PASSWORD"),
            database : config.get("MYSQL_DATABASE")
        });
    }

    public parseTransactions(blocks: any) {
        const extractedTransactions = blocks.flatMap((block: any) => {
            return block.transactions.map((tx: any) => {
                return this.extractTransactionData(block, tx);
            });
        });

        return this.fetchTransactionStateChanges(extractedTransactions).then((stateChanges:any) => {
            let balances:any = {};
            stateChanges.forEach((stateChange:any) => {
                let m = moment.unix(stateChange.timeStamp).endOf('day').unix();
                stateChange.changes.forEach((change:any) => {
                    if (change.address in balances) {
                        if (m in balances[change.address]) {
                            balances[change.address][m] = balances[change.address][m].add(Config.web3.utils.toBN(change.delta))
                        } else {
                            balances[change.address][m] = Config.web3.utils.toBN(change.delta);
                        }
                    } else {
                        balances[change.address] = {};
                        balances[change.address][m] = Config.web3.utils.toBN(change.delta);
                    }
                });
            });

            const connection = this.connection;
            const self = this;
            Object.keys(balances).forEach((address:any) => {
                connection.beginTransaction(function(err:any) {
                    if (err) {
                        throw err;
                    }
                    connection.query("select id from addresses where address=?", [address], function (error:any, results:any, fields:any) {
                        if (error) {
                            throw error;
                        }
                        if (results.length === 0)
                        {
                            connection.query("insert into addresses set address=?", address, function(error:any, results:any, fields:any) {
                                if (error) {
                                    throw error;
                                }
                                self.insertBalances(balances[address], results.insertId, connection);
                            });
                        } else {
                            self.insertBalances(balances[address], results[0].id, connection);
                        }
                    });
                });
            });
        });
    }

    private insertBalances(balance:any, address:any, connection:any) {
        let callbackCounter = 0;
        Object.keys(balance).forEach((timeStamp) => {
            connection.query("insert into balances (address_id, balance_date, delta) values (?, ?, ?) on duplicate key update delta = delta + " + balance[timeStamp].toString(),
                [address, timeStamp, balance[timeStamp].toString()], function(error:any, results:any, fields:any) {
                    if (error) {
                        throw error;
                    }
                    callbackCounter++;
                    if (callbackCounter === Object.keys(balance).length) {
                        connection.commit(function(err:any) {
                            if (err) {
                                return connection.rollback(function() {
                                    throw err;
                                });
                            }
                        });
                    }
                });
        });

    }

    extractTransactionData(block : any, transaction : any) {
        const from = String(transaction.from).toLowerCase();
        const to: string = transaction.to === null ? "" : String(transaction.to).toLowerCase();
        const addresses: string[] = to ? [from, to] : [from];

        return {
            _id: String(transaction.hash),
            blockNumber: Number(transaction.blockNumber),
            timeStamp: Number(block.timestamp),
            nonce: Number(transaction.nonce),
            from,
            to,
            value: String(transaction.value),
            gas: String(transaction.gas),
            gasPrice: String(transaction.gasPrice),
            gasUsed: String(0),
            input: String(transaction.input),
            addresses
        };
    }


    private async fetchTransactionStateChanges (transactions: any) {
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
                            batch.add(Config.web3.getBalanceStateChanges.request(tx._id, ["stateDiff"], (err: Error, stateChange: any) => {
                                if (completed) return;
                                if (!stateChange || err) {
                                    completed = true;
                                    reject(err);
                                }
                                const taggedStateChange = {changes: stateChange, timeStamp: tx.timeStamp};
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
            })

            return [].concat(...stateChanges)
        } catch (error) {
            winston.error(`Error getting transtaction state changes `, error)
            Promise.reject(error)
        }
    }

    // static getTransactions(blockNumber: number): Promise<any[]> {
    //     return Transaction.find({blockNumber: {$eq: blockNumber}})
    //         .populate({
    //             path: "operations",
    //             populate: {
    //                 path: "contract",
    //                 model: "ERC20Contract"
    //             }
    //         });
    // }
    //
    // static getTransactionsForAddress(address: string): Promise<any[]> {
    //     return Transaction.find({addresses: { "$in": [address] }})
    //         .populate({
    //             path: "operations",
    //             populate: {
    //                 path: "contract",
    //                 model: "ERC20Contract"
    //             }
    //         });
    // }
}
