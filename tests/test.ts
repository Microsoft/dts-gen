import * as fs from 'fs';
import * as path from 'path';

import * as tsg from '../lib';

const testModuleNames = [
    'fs',
    'path',
    'lodash',
    'jquery',
    'yargs',
    'ecurve',
];

class MyClass {
    constructor(public arg: number) {

    }
    prototypeMethod(_p: any) { }
    static staticMethod(_s: any) { }
    static staticNum = 32;
    instanceStr = 'inst';
}

function overriddenToString() {}
overriddenToString.toString = () => {
    throw new Error('`fn.toString()` should not be called');
};

const selfRefExpr = {
    a: 32,
    b: 'ok',
    self: <any> null,
};
selfRefExpr.self = selfRefExpr;

const expressions: { [s: string]: any } = {
    Math,
    selfref: selfRefExpr,
    builtIns: { d: new Date(3), arr: ['x']},
    someArray: [ 1, 'foo', Math, null, undefined, false ],
    badNames: { "*": 10, "default": true, "with": 10, "  ": 3 },
    someClass: MyClass,
    overriddenToString,
};

function checkDeclarationBaseline(name: string, content: string) {
    const filename = path.join(__dirname, `../../baselines/${name}`);
    const existing = fs.existsSync(filename) ? fs.readFileSync(filename, 'utf-8') : '<none>';
    if (existing !== content) {
        fs.writeFileSync(filename, content, 'utf-8');
        throw new Error(`Baseline ${name} changed`);
    }
}

describe("Module tests", () => {
    for (const moduleName of testModuleNames) {
        it(`Generates the same declaration for ${moduleName}`, () => {
            const result = tsg.generateModuleDeclarationFile(moduleName!, require(moduleName!));
            checkDeclarationBaseline(`module-${moduleName}.d.ts`, result);
        });
    }
});

describe("Expression tests", () => {
    for (const key of Object.keys(expressions)) {
        it(`Generates the same declaration for ${key}`, () => {
            const result = tsg.generateIdentifierDeclarationFile(key!, expressions[key!]);
            checkDeclarationBaseline(`expr-${key}.d.ts`, result);
        });
    }
});
