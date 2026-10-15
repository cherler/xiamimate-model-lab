import {startStatic} from './static-server.mjs';
import {createAssistantHandler} from '../services/assistant/http.mjs';
try{process.loadEnvFile(new URL('../.env',import.meta.url));}catch(e){if(e.code!=='ENOENT')throw e;}
startStatic({apiHandler:createAssistantHandler()});
