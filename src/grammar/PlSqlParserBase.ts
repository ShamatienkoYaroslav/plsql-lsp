import { Parser, TokenStream } from "antlr4ng";
import { PlSqlParser } from "./PlSqlParser.js";

export abstract class PlSqlParserBase extends Parser {
    private _isVersion12 = true;
    private _isVersion11 = true;
    private _isVersion10 = true;

    constructor(input: TokenStream) {
        super(input);
    }

    public isVersion12(): boolean {
        return this._isVersion12;
    }

    public setVersion12(value: boolean): void {
        this._isVersion12 = value;
    }

    public isVersion11(): boolean {
        return this._isVersion11;
    }

    public setVersion11(value: boolean): void {
        this._isVersion11 = value;
    }

    public isVersion10(): boolean {
        return this._isVersion10;
    }

    public setVersion10(value: boolean): void {
        this._isVersion10 = value;
    }

    public IsNotNumericFunction(): boolean {
        const lt1 = this.tokenStream.LT(1);
        const lt2 = this.tokenStream.LT(2);
        if (
            lt1 !== null &&
            lt2 !== null &&
            (lt1.type === PlSqlParser.SUM ||
                lt1.type === PlSqlParser.COUNT ||
                lt1.type === PlSqlParser.AVG ||
                lt1.type === PlSqlParser.MIN ||
                lt1.type === PlSqlParser.MAX ||
                lt1.type === PlSqlParser.ROUND ||
                lt1.type === PlSqlParser.LEAST ||
                lt1.type === PlSqlParser.GREATEST) &&
            lt2.type === PlSqlParser.LEFT_PAREN
        ) {
            return false;
        }
        return true;
    }
}
