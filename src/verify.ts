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
let endOfBlockDelay = parseInt(config.get("PARSER.DELAYS.END_OF_BLOCK")) || 5000;
let betweenBlockDelay = parseInt(config.get("PARSER.DELAYS.BETWEEN_BLOCK")) || 100;
let afterValidateDelay = parseInt(config.get("PARSER.DELAYS.AFTER_VALIDATE")) || 800;
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
                    console.log("LastBlock: " + lastBlockTimestamp + " EndOfDayTime: " + lastBlockTimestamp);

                    let blocks: any = [];
                    let currentDayBalance: any = {'earned': {}, 'spent': {}, 'tx_earned': {}, 'tx_spent': {}};

                    setTimeout(process, betweenBlockDelay);

                    function process() {
                        if (currentBlockNumber % checkpoint === 0) {
                            console.log(progressInfo.info(currentBlockNumber));
                            progressInfo.checkpoint();
                        }
                        if (currentBlockNumber > latestBlockOnChain) {
                            if (starter.shouldVerify) {
                                console.log("Verify done, last block reached");
                                return;
                            }
                            console.log("At last block, sleeping...");
                            setDelay(endOfBlockDelay).then(() => {
                                Config.web3.eth.getBlockNumber((error:any, number:any) => {
                                    if (error) throw error;
                                    latestBlockOnChain = number;
                                    Config.web3.eth.getBlock(latestBlockOnChain, false, function (error: any, result: any) {
                                        if (error) throw error;
                                        lastBlockTimestamp = moment.unix(result.timestamp).utc().endOf('day').unix();
                                        progressInfo = new ProgressInfo(latestBlockOnChain, checkpoint);
                                        setTimeout(process, betweenBlockDelay);
                                    });
                                });
                            });
                            return;
                        } else {
                            blocks.push(starter.next(currentBlockNumber, currentDayTimestamp));
                            currentBlockNumber++;
                            if ((blocks.length > maxConcurrentBlocks) || (currentDayTimestamp === lastBlockTimestamp)) {
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
                                            Object.keys(result.changes['earned']).forEach((address: any) => {
                                                if (!(address in currentDayBalance['earned'])) {
                                                    currentDayBalance['earned'][address] = Config.web3.utils.toBN(0);
                                                }

                                                if (results[address] != 0) {
                                                    currentDayBalance['earned'][address] = currentDayBalance['earned'][address].add(result.changes['earned'][address]);
                                                }
                                            });
                                            Object.keys(result.changes['spent']).forEach((address: any) => {
                                                if (!(address in currentDayBalance['spent'])) {
                                                    currentDayBalance['spent'][address] = Config.web3.utils.toBN(0);
                                                }

                                                if (results[address] != 0) {
                                                    currentDayBalance['spent'][address] = currentDayBalance['spent'][address].add(result.changes['spent'][address]);
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
                                        starter.validate(currentDayTimestamp, currentDayBalance).then(() => {
                                            Config.web3.eth.getBlock(currentBlockNumber, true).then((firstBlock: any) => {
                                                const m = moment.unix(firstBlock.timestamp).utc().endOf('day');
                                                currentDayTimestamp = m.unix();
                                                console.log("Started new day: " + currentDayTimestamp + " on block " + currentBlockNumber);
                                                currentDayBalance = {'earned': {}, 'spent': {}, 'tx_earned': {}, 'tx_spent': {}};
                                                connection.query("replace into validate_status (id, current_full_validate_block) values (1, ?)", [currentBlockNumber], function (error: any, results: any, fields: any) {
                                                    if (error) {
                                                        throw error;
                                                    }
                                                });
                                                setTimeout(process, afterValidateDelay);
                                                return;
                                            });
                                        });
                                    } else if (currentDayTimestamp === lastBlockTimestamp) {
                                        if ((currentBlockNumber % 100) === 0) {
                                            starter.validate(currentDayTimestamp, currentDayBalance).then(() => {
                                                Config.web3.eth.getBlock(currentBlockNumber, true).then((firstBlock: any) => {
                                                    console.log("Updated last day on block " + currentBlockNumber);
                                                    setTimeout(process, afterValidateDelay);
                                                    return;
                                                });
                                            });
                                        } else {
                                            setTimeout(process, betweenBlockDelay);
                                            return;
                                        }
                                    } else {
                                        setTimeout(process, betweenBlockDelay);
                                        return;
                                    }
                                });
                            } else {
                                setTimeout(process, betweenBlockDelay);
                                return;
                            }
                        }
                    }
                });
            });

            console.log("Verification started");
        });
    });
});

