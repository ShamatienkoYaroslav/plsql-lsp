// Post-process ANTLR generated files to add missing base class imports.
const fs = require("fs");
const path = require("path");

const grammarDir = path.join(__dirname, "..", "src", "grammar");

const fixes = [
    {
        file: "PlSqlLexer.ts",
        marker: 'import { Token } from "antlr4ng";',
        insert: 'import { PlSqlLexerBase } from "./PlSqlLexerBase.js";',
    },
    {
        file: "PlSqlParser.ts",
        marker: 'import { Token } from "antlr4ng";',
        insert: 'import { PlSqlParserBase } from "./PlSqlParserBase.js";',
    },
];

for (const fix of fixes) {
    const filePath = path.join(grammarDir, fix.file);
    let content = fs.readFileSync(filePath, "utf8");
    if (!content.includes(fix.insert)) {
        content = content.replace(fix.marker, fix.marker + "\n" + fix.insert);
        fs.writeFileSync(filePath, content, "utf8");
        console.log(`Fixed imports in ${fix.file}`);
    } else {
        console.log(`Imports already present in ${fix.file}`);
    }
}
