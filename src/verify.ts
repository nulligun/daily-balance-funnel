import { Validator } from "./common/Validator";
import { Config } from "./common/Config";
import {setDelay} from "./common/Utils";
import moment = require("moment");

const config = require("config");
const mysql = require("mysql");
const ProgressInfo = require('progress-info');

const minimist = require('minimist');

let args = minimist(process.argv.slice(2), {
    default: {
        v: false
    }
});


Config.initWeb3();

const connection = mysql.createConnection({
    host     : config.get("MYSQL_HOST"),
    user     : config.get("MYSQL_USER"),
    password : config.get("MYSQL_PASSWORD"),
    database : config.get("MYSQL_DATABASE"),
    supportBigNumbers : true,
    bigNumberStrings : true

});

let maxConcurrentBlocks = parseInt(config.get("PARSER.MAX_CONCURRENT_BLOCKS")) || 5;
let checkpoint = 1000;

connection.query("select current_full_validate_block from validate_status", function(error:any, results:any, fields:any) {
    let currentBlockNumber = 1;
    if (error) throw error;
    if (results.length > 0) {
        currentBlockNumber = results[0].current_full_validate_block;
    }

    Config.web3.eth.getBlock(currentBlockNumber, true).then((firstBlock:any) => {
        const m = moment.unix(firstBlock.timestamp).utc().endOf('day');
        let currentDayTimestamp = m.unix();

        const starter = new Validator(connection, args.v);
        starter.loadAddresses().then(() => {
            console.log("Addresses loaded");
            Config.web3.eth.getBlockNumber((error: any, number:any) => {
                if (error) throw error;
                let latestBlockOnChain = number;
                let progressInfo = new ProgressInfo(latestBlockOnChain, checkpoint);

                Config.web3.eth.getBlock(latestBlockOnChain, false, function (error: any, result: any) {
                    if (error) throw error;
                    let lastBlockTimestamp = moment.unix(result.timestamp).utc().endOf('day').unix();

                    let blocks: any = [];
                    let currentDayBalance: any = {};

                    process();

                    function process() {
                        if (currentBlockNumber % checkpoint === 0) {
                            console.log(progressInfo.info(currentBlockNumber));
                            progressInfo.checkpoint();
                        }
                        if (currentBlockNumber > latestBlockOnChain) {
                            console.log("At last block, sleeping...");
                            setDelay(5000).then(() => {
                                latestBlockOnChain = Config.web3.eth.getBlockNumber();
                                progressInfo = new ProgressInfo(latestBlockOnChain, checkpoint);
                                Config.web3.eth.getBlock(latestBlockOnChain, false, function (error: any, result: any) {
                                    if (error) throw error;
                                    lastBlockTimestamp = moment.unix(result.timestamp).utc().endOf('day').unix();
                                    process();
                                });
                            });
                        } else {
                            blocks.push(starter.next(currentBlockNumber, currentDayTimestamp));
                            currentBlockNumber++;
                            if (blocks.length > maxConcurrentBlocks) {
                                let maxValidBlock = 0;
                                let maxBlockNumber = 0;
                                let done = false;
                                Promise.all(blocks).then((results: any) => {
                                    results.forEach((result: any) => {
                                        if (result.block > maxBlockNumber) {
                                            maxBlockNumber = result.block;
                                        }
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
                                    if (maxValidBlock === 0) maxValidBlock = maxBlockNumber;
                                    if (maxValidBlock === 0) {
                                        console.log("We didn't find a maxValidBlock, WTF");
                                        throw "Max block not found";
                                    }
                                    currentBlockNumber = maxValidBlock + 1;
                                    if ((currentBlockNumber % 500) === 0) {
                                        console.log("Moving on to block: " + currentBlockNumber);
                                    }
                                    blocks = [];
                                    if (done) {
                                        starter.validate(currentDayTimestamp, currentDayBalance).then((res) => {});

                                        Config.web3.eth.getBlock(currentBlockNumber, true).then((firstBlock: any) => {
                                            const m = moment.unix(firstBlock.timestamp).utc().endOf('day');
                                            currentDayTimestamp = m.unix();
                                            console.log("Started new day: " + currentDayTimestamp + " on block " + currentBlockNumber);
                                            currentDayBalance = {};
                                            connection.query("replace into validate_status (id, current_full_validate_block) values (1, ?)", [currentBlockNumber], function (error: any, results: any, fields: any) {
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
                                if (currentDayTimestamp === lastBlockTimestamp) {
                                    starter.validate(currentDayTimestamp, currentDayBalance).then((res) => {});
                                }
                                process();
                            }
                        }
                    }
                });
            });

            console.log("Verification started");
        });
    });
});

