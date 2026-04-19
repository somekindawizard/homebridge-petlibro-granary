import { API } from 'homebridge';

import { PetLibroPlatform } from './platform';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';

/**
 * This is the entry point that Homebridge calls when loading the plugin.
 * It registers our dynamic platform with Homebridge.
 */
export = (api: API): void => {
  api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, PetLibroPlatform);
};
