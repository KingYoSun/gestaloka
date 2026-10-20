import { mergeConfig } from "vite";
import base from "../web/vite.config.js";
export default mergeConfig(base, { server: { port: 5174 } });
