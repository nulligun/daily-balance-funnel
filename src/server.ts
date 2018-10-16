import { FunnelStarter } from "./common/FunnelStarter";
import { Config } from "./common/Config";

Config.initWeb3();

const starter = new FunnelStarter();
starter.start();
