#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import * as yargs from 'yargs';

import * as guess from './';
import writeDefinitelyTypedPackage from './definitely-typed';

const templatesDirectory = path.join(__dirname, "..", "..", "templates");

interface Options {
    module?: string;
    expression?: string;
    'expression-file': string;
    identifier?: string;
    template?: string;

    name?: string;

    file?: string | boolean;
    dt?: string | boolean;
    stdout?: boolean;
    overwrite?: boolean;

    version?: boolean;
}

const args = yargs
    .alias('m', 'module')
    .alias('i', 'identifier')
    .alias('e', 'expression')
    .alias('n', 'name')
    .alias('f', 'file')
    .alias('d', 'dt')
    .alias('s', 'stdout')
    .alias('o', 'overwrite')
    .alias('t', 'template')
    .alias('v', 'version')
    .argv as any as Options;

class ArgsError extends Error {
    constructor(public argsError: string) {
        super();
        this.name = 'ArgsError';
        this.message = argsError;

        Object.setPrototypeOf(this, ArgsError.prototype);
    }
}

let result: string | undefined;
try {
    if (args.version) {
        console.log(require("../../package.json").version);
        process.exit(0);
    }

    if (+!!args.dt + +!!args.file + +!!args.stdout > 1) {
        throw new ArgsError('Cannot specify more than one output mode');
    }
    if (+!!args.identifier + +!!args.expression + +!!args.module + +!!args['expression-file'] + +!!args.template
        !== 1) {
        throw new ArgsError('Must specify exactly one input');
    }
    if (typeof args.name === 'boolean') throw new ArgsError('Must specify a value for "--name"');
    if (typeof args.identifier === 'boolean') throw new ArgsError('Must specify a value for "--identifier"');
    if (typeof args.module === 'boolean') throw new ArgsError('Must specify a value for "--module"');
    if (args.overwrite !== undefined && args.overwrite !== true)
        throw new ArgsError('--overwrite does not accept an argument');

    let name: string;
    if (args.module) {
        if (args.name) throw new ArgsError('Cannot use --name with --module');
        name = args.module;
        (module as any).paths.unshift(process.cwd() + '/node_modules');
        result = guess.generateModuleDeclarationFile(args.module, require(args.module));
    } else if (args.expression) {
        name = args.name || 'dts_gen_expr';
        result = guess.generateIdentifierDeclarationFile(name, eval(args.expression));
    } else if (args['expression-file']) {
        if (args.name) throw new ArgsError('Cannot use --name with --expression-file');
        const filename = args['expression-file'];
        name = path.basename(filename, path.extname(filename)).replace(/[^A-Za-z0-9]/g, '_');
        (module as any).paths.unshift(process.cwd() + '/node_modules');
        result = guess.generateIdentifierDeclarationFile(name, require(path.resolve(filename)));
    } else if (args.identifier) {
        if (args.name) throw new ArgsError('Cannot use --name with --identifier');
        if (args.module || args.expression) throw new ArgsError('Cannot specify more than one input');
        name = args.identifier;
        result = guess.generateIdentifierDeclarationFile(args.identifier, eval(args.identifier));
    } else if (args.template) {
        if (!args.name) throw new ArgsError('Needs a name');
        name = args.name;
        if (args.module || args.expression) throw new ArgsError('Cannot mix --template with --module or --expression');
        result = getTemplate(args.template);
    } else {
        throw new Error('Internal error, please log a bug with the commandline you specified');
    }

    if (args.dt) {
        writeDefinitelyTypedPackage(result, name, !!args.overwrite);
    } else if (args.stdout) {
        console.log(result);
    } else {
        let filename =
            typeof args.file === 'boolean' || args.file === undefined ? name + '.d.ts' : args.file;
        if (!filename.endsWith('.d.ts')) {
            filename = filename + '.d.ts';
        }

        if (!args.overwrite && fs.existsSync(filename)) {
            console.error(`File ${filename} already exists and --overwrite was not specified; exiting.`);
            process.exit(2);
        }
        fs.writeFileSync(filename, prependOurHeader(result), 'utf-8');
        console.log(`Wrote ${result.split(/\r\n|\r|\n/).length} lines to ${filename}.`);
    }
} catch (e) {
    if (e instanceof ArgsError) {
        console.error('Invalid arguments: ' + e.argsError);
        console.log('');
        printHelp();
        process.exit(1);
    } else if (e.code === 'MODULE_NOT_FOUND') {
        console.error(`Error loading module "${args.module}".\n` +
          getErrorMessageFirstLine(e).replace(/'/g, '"') + '.\n' +
          `Please install missing module and try again.`);
        process.exit(1);
    } else {
        console.log('Unexpected crash! Please log a bug with the commandline you specified.');
        throw e;
    }
}

function printHelp() {
    console.log('Usage: dts-gen input [settings] [output]');
    console.log('');
    console.log('Input Options:');
    console.log('  -m[odule] fs            The "fs" node module (must be installed)');
    console.log('  -i[dentifier] Math      The global variable "Math"');
    console.log('  -e[xpression] "new C()" The expression "new C()"');
    console.log('  -t[emplate] module      Name of a template. Templates are:');
    console.log(`                          ${allTemplateNames()}`);
    console.log('');
    console.log('Settings:');
    console.log('  -n[ame] n               The name to emit when generating for an expression');
    console.log('');
    console.log('Output Options:');
    console.log('  -f[ile] [filename.d.ts]  Write to a file (default)');
    console.log('  -d[t] [dirName]          Create a folder suitable for DefinitelyTyped');
    console.log('  -s[tdout]                Write to stdout');
    console.log('  -o[verwrite]             Allow overwriting files');
    console.log('');
    console.log('Example: dts-gen -m fs --stdout');
}

function prependOurHeader(result: string) {
    return `/** Declaration file generated by dts-gen */\r\n\r\n` + result;
}

function getTemplate(templateName: string): string {
    try {
    return fs.readFileSync(path.join(templatesDirectory, templateName + ".d.ts"), "utf-8");
    } catch (e) {
        throw new ArgsError(`Could not read template '${templateName}'. Expected one of:\n${allTemplateNames()}`);
    }
}

function allTemplateNames(): string {
    return fs.readdirSync(templatesDirectory).map(t => t.slice(0, t.length - ".d.ts".length)).join(", ");
}

function getErrorMessageFirstLine(error: Error): string {
    return error.message.split('\n', 1)[0];
}
