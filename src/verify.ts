import { Validator } from "./common/Validator";
import { Config } from "./common/Config";
import {setDelay} from "./common/Utils";
import moment = require("moment");

const config = require("config");
const mysql = require("mysql");


Config.initWeb3();

const connection = mysql.createConnection({
    host     : config.get("MYSQL_HOST"),
    user     : config.get("MYSQL_USER"),
    password : config.get("MYSQL_PASSWORD"),
    database : config.get("MYSQL_DATABASE")
});

let maxConcurrentBlocks = parseInt(config.get("PARSER.MAX_CONCURRENT_BLOCKS")) || 5;

connection.query("select current_full_validate_block from validate_status", function(error:any, results:any, fields:any) {
    let currentBlockNumber = 1;
    if (error) throw error;
    if (results.length > 0) {
        currentBlockNumber = results[0].current_full_validate_block;
    }

    Config.web3.eth.getBlock(currentBlockNumber, true).then((firstBlock:any) => {
        const m = moment.unix(firstBlock.timestamp).utc().endOf('day');
        let currentDayTimestamp = m.unix();
        const starter = new Validator(connection);
        starter.loadAddresses().then(() => {
            console.log("Addresses loaded");
            Config.web3.eth.getBlockNumber((error: any, number:any) => {
                if (error) throw error;
                let latestBlockOnChain = number;
                let blocks: any = [];
                let currentDayBalance: any = {};

                process();

                function process() {
                    if (currentBlockNumber > latestBlockOnChain) {
                        setDelay(5000).then(() => {
                            latestBlockOnChain = Config.web3.eth.getBlockNumber();
                            process();
                        });
                    } else {
                        blocks.push(starter.next(currentBlockNumber, currentDayTimestamp));
                        currentBlockNumber++;
                        if (blocks.length > maxConcurrentBlocks) {
                            let maxValidBlock = 0;
                            let done = false;
                            Promise.all(blocks).then((results: any) => {
                                results.forEach((result: any) => {
                                    if ('status' in result) {
                                        done = true;
                                    } else {
                                        if (result.block > maxValidBlock) {
                                            maxValidBlock = result.block;
                                        }
                                        Object.keys(result.changes).forEach((address: any) => {
                                            if (!(address in currentDayBalance)) {
                                                currentDayBalance[address] = Config.web3.utils.toBN(0);
                                            }

                                            if (results[address] != 0) {
                                                currentDayBalance[address] = currentDayBalance[address].add(result.changes[address]);
                                            }
                                        });
                                    }
                                });
                                currentBlockNumber = maxValidBlock + 1;
                                blocks = [];
                                if (done) {
                                    starter.validate(currentDayTimestamp, currentDayBalance);

                                    Config.web3.eth.getBlock(currentBlockNumber, true).then((firstBlock: any) => {
                                        const m = moment.unix(firstBlock.timestamp).utc().endOf('day');
                                        currentDayTimestamp = m.unix();
                                        console.log("Started new day: " + currentDayTimestamp + " on block " + currentBlockNumber);
                                        currentDayBalance = {};
                                        connection.query("update validate_status set current_full_validate_block = ?", [currentBlockNumber], function (error: any, results: any, fields: any) {
                                            if (error) {
                                                throw error;
                                            }
                                        });
                                        process();
                                    });
                                } else {
                                    process();
                                }
                            });
                        } else {
                            process();
                        }
                    }
                }
            });

            console.log("Verification started");
        });
    });
});

