import AsyncStorage from "@react-native-async-storage/async-storage";
import { api } from "../api";
import { createDriverV2Sync } from "./driverV2Sync";

export const driverV2Sync = createDriverV2Sync({ storage: AsyncStorage, api });
