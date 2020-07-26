import * as dom from 'dts-dom';
import { create, reservedWords } from 'dts-dom';
import { getDTName } from './names';
import { stringifyFunction } from './util';
import * as ts from 'typescript';

const enum ValueTypes {
    None = 0,
    Class = 1 << 0,
    Function = 1 << 1,
    Object = 1 << 2,
    Primitive = 1 << 3,
    NullOrUndefined = 1 << 4,
    Unknown = 1 << 5,
}

const builtins: { [name: string]: (new (...args: any[]) => any) | undefined } = {
    Date,
    RegExp,
    Map: (typeof Map !== 'undefined') ? Map : undefined,
    HTMLElement: (typeof HTMLElement !== 'undefined') ? HTMLElement : undefined,
};

function forceAsIdentifier(s: string): string {
    // TODO: Make this more comprehensive
    return getDTName(s.replace(/-/g, '_'));
}

function getValueTypes(value: any): ValueTypes {
    if (typeof value === 'object') {
        // Objects can't be callable, so no need to check for class / function
        return ValueTypes.Object;
    } else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return ValueTypes.Primitive;
    } else if (value === null || value === undefined) {
        return ValueTypes.NullOrUndefined;
    } else if (typeof value === 'function') {
        if (isClasslike(value)) {
            return ValueTypes.Class | (hasCloduleProperties(value) ? ValueTypes.Object : ValueTypes.None);
        } else {
            return ValueTypes.Function | (hasFunduleProperties(value) ? ValueTypes.Object : ValueTypes.None);
        }
    } else {
        return ValueTypes.Unknown;
    }
}

// A class has clodule properties if it has any classes. Anything else can be written with 'static'
function hasCloduleProperties(c: any): boolean {
    return getKeysOfObject(c).some(k => isClasslike(c[k]));
}

// A function has fundule properties if it has any own properties not belonging to Function.prototype
function hasFunduleProperties(fn: any): boolean {
    return getKeysOfObject(fn).some(k => (<any> Function)[k] === undefined);
}

export function generateModuleDeclarationFile(nameHint: string, root: any) {
    const localName = forceAsIdentifier(nameHint);
    const decls = getTopLevelDeclarations(localName, root);
    // If we get back just a namespace, we can avoid writing an export=
    if (decls.length === 1 && decls[0].kind === 'namespace') {
        // Hoist out all the declarations and export them
        const members = (decls[0] as dom.NamespaceDeclaration).members;
        for (const m of members) m.flags = m.flags! | dom.DeclarationFlags.Export;
        return members.map(m => dom.emit(m)).join('');
    } else {
        // Going to have to write an export=
        const result: string[] = decls.map(d => dom.emit(d));
        result.unshift(dom.emit(dom.create.exportEquals(localName)));
        return result.join('');
    }
}

export function generateIdentifierDeclarationFile(name: string, value: any): string {
    const result = getTopLevelDeclarations(name, value);
    return result.map(d => dom.emit(d)).join('\r\n');
}

const walkStack = new Set<any>();

const reservedFunctionProperties = Object.getOwnPropertyNames(() => {});
function getKeysOfObject(obj: object) {
    let keys: string[] = [];
    let chain: {} = obj;
    do {
        if (chain == null) break;
        keys = keys.concat(Object.getOwnPropertyNames(chain));
        chain = Object.getPrototypeOf(chain);
    } while (chain !== Object.prototype && chain !== Function.prototype);
    keys = Array.from(new Set(keys));
    keys = keys.filter(s => isVisitableName(s));
    if (typeof obj === 'function') {
        keys = keys.filter(k => reservedFunctionProperties.indexOf(k) < 0);
    }

    keys.sort();
    return keys;
}

function isVisitableName(s: string) {
    return (s[0] !== '_') && (["caller", "arguments", "constructor", "super_", "prototype"].indexOf(s) < 0);
}

function isLegalIdentifier(s: string) {
    if (s.length === 0) {
        return false;
    }
    if (!ts.isIdentifierStart(s.charCodeAt(0), ts.ScriptTarget.Latest)) {
        return false;
    }
    for (let i = 1; i < s.length; i++) {
        if (!ts.isIdentifierPart(s.charCodeAt(i), ts.ScriptTarget.Latest)) {
            return false;
        }
    }
    return reservedWords.indexOf(s) < 0;
}

function isClasslike(obj: { prototype: any }): boolean {
    return !!(obj.prototype && Object.getOwnPropertyNames(obj.prototype).length > 1);
}

const keyStack: string[] = [];
function getTopLevelDeclarations(name: string, obj: any): dom.NamespaceMember[] {
    if (walkStack.has(obj) || keyStack.length > 4) {
        // Circular or too-deep reference
        const result = create.const(name, dom.type.any);
        result.comment = (walkStack.has(obj) ? 'Circular reference' : 'Too-deep object hierarchy') +
            ` from ${keyStack.join('.')}`;
        return [result];
    }

    if (!isLegalIdentifier(name)) return [];

    walkStack.add(obj);
    keyStack.push(name);
    const res = getResult();
    keyStack.pop();
    walkStack.delete(obj);
    return res;

    function getResult(): dom.NamespaceMember[] {
        if (typeof obj === 'function') {
            const funcType = getParameterListAndReturnType(obj, parseFunctionBody(obj));
            const ns = dom.create.namespace(name);
            let primaryDecl: dom.NamespaceMember;
            if (isClasslike(obj)) {
                const cls = dom.create.class(name);
                getClassPrototypeMembers(obj).forEach(m => cls.members.push(m));
                cls.members.push(dom.create.constructor(funcType[0]));
                cls.members.sort(declarationComparer);
                primaryDecl = cls;
            } else {
                const parsedFunction = parseFunctionBody(obj);
                const info = getParameterListAndReturnType(obj, parsedFunction);
                primaryDecl = dom.create.function(name, info[0], info[1]);
            }

            // Get clodule/fundule members
            const keys = getKeysOfObject(obj);
            for (const k of keys) {
                getTopLevelDeclarations(k!, obj[k!]).forEach(p => {
                    if (primaryDecl.kind === "class") {
                        // Transform certain declarations into static members
                        switch (p.kind) {
                            case 'const':
                                primaryDecl.members.push(create.property(p.name, p.type, dom.DeclarationFlags.Static));
                                break;
                            case 'function':
                                primaryDecl.members.push(
                                    create.method(p.name, p.parameters, p.returnType, dom.DeclarationFlags.Static));
                                break;
                            default:
                                ns.members.push(p);
                                break;
                        }
                    } else {
                        ns.members.push(p);
                    }
                });
                ns.members.sort(declarationComparer);
            }

            return ns.members.length > 0 ? [primaryDecl, ns] : [primaryDecl];
        } else if (typeof obj === 'object') {
            // If we can immediately resolve this to a simple declaration, just do so
            const simpleType = getTypeOfValue(obj);
            if (typeof simpleType === 'string' || simpleType.kind === 'name' || simpleType.kind === 'array') {
                const result = dom.create.const(name, simpleType);
                if (simpleType === 'string') {
                    const preview = `"${simpleType.substr(0, 100)}${simpleType.length > 100 ? '...' : ''}"`;
                    result.comment = "Value of string: " + preview;
                }
                return [result];
            }

            // If anything in here is classlike or functionlike, write it as a namespace.
            // Otherwise, write as a 'const'
            const keys = getKeysOfObject(obj);
            let constituentTypes = ValueTypes.None;
            for (const k of keys) {
                constituentTypes = constituentTypes | getValueTypes((<any> obj)[k!]);
            }
            if (constituentTypes & (ValueTypes.Class | ValueTypes.Function)) {
                const ns = dom.create.namespace(name);
                for (const k of keys) {
                    const decls = getTopLevelDeclarations(k!, (<any> obj)[k!]);
                    decls.forEach(d => ns.members.push(d));
                }
                ns.members.sort(declarationComparer);
                return [ns];
            } else {
                return [dom.create.const(name, simpleType)];
            }
        } else if (typeof obj === 'string' || typeof obj === 'number' || typeof obj === 'boolean') {
            return [create.const(name, <dom.Type> (typeof obj))];
        } else {
            return [create.const(name, dom.type.any)];
        }
    }
}

function getTypeOfValue(value: any): dom.Type {
    for (const k in builtins) {
        if (builtins[k] && value instanceof builtins[k]!) {
            return create.namedTypeReference(k);
        }
    }

    if (Array.isArray(value)) {
        if (value.length > 0) {
            return create.array(getTypeOfValue(value[0]));
        } else {
            return create.array(dom.type.any);
        }
    }

    const type = typeof value;
    switch (type) {
        case 'string':
        case 'number':
        case 'boolean':
            return type;
        case 'undefined':
            return dom.type.any;
        case 'object':
            if (value === null) {
                return dom.type.any;
            } else {
                walkStack.add(value);
                const members = getPropertyDeclarationsOfObject(value);
                walkStack.delete(value);
                members.sort(declarationComparer);
                const objType = dom.create.objectType(members);
                return objType;
            }
        default:
            return dom.type.any;
    }
}

function getPropertyDeclarationsOfObject(obj: any): dom.ObjectTypeMember[] {
    walkStack.add(obj);
    const keys = getKeysOfObject(obj);
    const result = keys.map(getProperty);
    walkStack.delete(obj);
    return result;

    function getProperty(k: string) {
        if (walkStack.has(obj[k])) {
            return create.property(k, dom.type.any);
        }
        return create.property(k, getTypeOfValue(obj[k]));
    }
}

function getClassPrototypeMembers(ctor: any): dom.ClassMember[] {
    const names = Object.getOwnPropertyNames(ctor.prototype);
    const members = <dom.ClassMember[]> names
        .filter(n => !isNameToSkip(n))
        .map(name =>
            getPrototypeMember(name, Object.getOwnPropertyDescriptor(ctor.prototype, name)!.value))
        .filter(m => m !== undefined);
    members.sort();
    return members;

    function getPrototypeMember(name: string, obj: any): dom.ClassMember | undefined {
        // Skip non-function objects on the prototype (not sure what to do with these?)
        if (typeof obj !== 'function') {
            return undefined;
        }

        const funcType = getParameterListAndReturnType(obj, parseFunctionBody(obj));
        const result = create.method(name, funcType[0], funcType[1]);
        if (isNativeFunction(obj)) {
            result.comment = 'Native method; no parameter or return type inference available';
        }
        return result;
    }

    function isNameToSkip(s: string) {
        return (s === 'constructor') || (s[0] === '_');
    }
}

function declarationComparer(left: any, right: any) {
    if (left.kind === right.kind) {
        return left.name > right.name ? 1 : left.name < right.name ? -1 : 0;
    } else {
        return left.kind > right.kind ? 1 : left.kind < right.kind ? -1 : 0;
    }
}

function getParameterListAndReturnType(obj: Function, fn: ts.FunctionExpression): [dom.Parameter[], dom.Type] {
    let usedArguments = false;
    let hasReturn = false;
    const funcStack: boolean[] = [];

    if (isNativeFunction(obj)) {
        const args: dom.Parameter[] = [];
        for (let i = 0; i < obj.length; i++) {
            args.push(create.parameter(`p${i}`, dom.type.any));
        }
        return [args, dom.type.any];
    } else {
        ts.forEachChild(fn, visit);

        let params = [create.parameter('args', dom.type.array(dom.type.any), dom.ParameterFlags.Rest)];
        if (fn.parameters) {
            params = fn.parameters.map(p => create.parameter(`${p.name.getText()}`, inferParameterType(fn, p)));
            if (usedArguments) {
                params.push(create.parameter('args', dom.type.array(dom.type.any), dom.ParameterFlags.Rest));
            }
        }
        return [params, hasReturn ? dom.type.any : dom.type.void];
    }

    function visit(node: ts.Node) {
        switch (node.kind) {
            case ts.SyntaxKind.Identifier:
                if ((node as ts.Identifier).getText() === 'arguments') {
                    usedArguments = true;
                }
                break;
            case ts.SyntaxKind.ReturnStatement:
                const ret = node as ts.ReturnStatement;
                if (funcStack.length === 0 && ret.expression && ret.expression.kind !== ts.SyntaxKind.VoidExpression) {
                    hasReturn = true;
                }
        }
        switch (node.kind) {
            case ts.SyntaxKind.FunctionExpression:
            case ts.SyntaxKind.FunctionDeclaration:
                funcStack.push(true);
                ts.forEachChild(node, visit);
                funcStack.pop();

            default:
                ts.forEachChild(node, visit);
                break;
        }
    }

}

function inferParameterType(_fn: ts.FunctionExpression, _param: ts.ParameterDeclaration): dom.Type {
    // TODO: Inspect function body for clues
    return dom.type.any;
}

function parseFunctionBody(fn: any): ts.FunctionExpression {
    const setup = `const myFn = ${stringifyFunction(fn)};`;
    const srcFile = ts.createSourceFile('test.ts', setup, ts.ScriptTarget.Latest, true);
    const statement = srcFile.statements[0] as ts.VariableStatement;
    const decl = statement.declarationList.declarations[0];
    const init = decl.initializer as ts.FunctionExpression;
    return init;
}

function isNativeFunction(fn: any) {
    return stringifyFunction(fn).indexOf('{ [native code] }') > 0;
}
