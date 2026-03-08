import { CharStream, Lexer, Token } from "antlr4ng";

export abstract class PlSqlLexerBase extends Lexer {
    constructor(input: CharStream) {
        super(input);
    }

    protected IsNewlineAtPos(pos: number): boolean {
        const la = this.inputStream.LA(pos);
        return la === -1 || la === "\n".charCodeAt(0);
    }
}
