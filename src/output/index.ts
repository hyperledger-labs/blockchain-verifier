import { ResultSet } from "../result-set";

export interface OutputPlugin {
    convertResult(resultSet: ResultSet): Promise<Buffer>;
}
