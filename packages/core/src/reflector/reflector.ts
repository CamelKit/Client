/*! 

Copyright (C) 2025  HighLite

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.

*/

import { parse, Node } from 'acorn';
import * as walk from 'acorn-walk';
import { HighliteResources } from '../utilities/resources';
import { HookManager } from '../managers/highlite/hookManager';
import { ClassInfo, EnumInfo, ClassSignature, EnumSignature, HookMap, HookEntries } from './types';
import { ClassSignatures, EnumSignatures } from './signatures';

interface ReflectorState {
    classes: ClassInfo[];
    enums: EnumInfo[];
    classHooks: HookMap;
    enumHooks: HookMap;
}

// Define the hook reflector for mapping classes and statements
export class Reflector {

    // Define the source
    private static source: string;

    // Define the AST
    private static ast: Node;

    // Shared global state across module boundaries (Vite bundle vs dynamic imports)
    private static get state(): ReflectorState {
        const g = (typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : {})) as any;
        if (!g.__camelkitReflectorState) {
            g.__camelkitReflectorState = {
                classes: [],
                enums: [],
                classHooks: new Map(),
                enumHooks: new Map(),
            };
        }
        return g.__camelkitReflectorState;
    }

    // Define the classes
    private static get classes(): ClassInfo[] {
        return Reflector.state.classes;
    }
    private static set classes(val: ClassInfo[]) {
        Reflector.state.classes = val;
    }

    // Define the enums
    private static get enums(): EnumInfo[] {
        return Reflector.state.enums;
    }
    private static set enums(val: EnumInfo[]) {
        Reflector.state.enums = val;
    }

    // Define the class hooks
    private static get classHooks(): HookMap {
        return Reflector.state.classHooks;
    }
    private static set classHooks(val: HookMap) {
        Reflector.state.classHooks = val;
    }

    // Define the enum hooks
    private static get enumHooks(): HookMap {
        return Reflector.state.enumHooks;
    }
    private static set enumHooks(val: HookMap) {
        Reflector.state.enumHooks = val;
    }

    // Look the hooks from client source (single module or array of modules)
    static async loadHooksFromSource(source : string | string[]): Promise<void> {
        if (Array.isArray(source)) {
            await Reflector.loadHooksFromModules(source);
            return;
        }

        await Reflector.loadHooksFromModules([source]);
    }

    // Load hooks from an array of independent JS module sources
    static async loadHooksFromModules(modules: string[]): Promise<void> {
        Reflector.classes = [];
        Reflector.enums = [];

        for (const modSource of modules) {
            if (!modSource || typeof modSource !== 'string') continue;
            try {
                const ast = parse(modSource, {
                    ecmaVersion: 'latest',
                    sourceType: 'module'
                }) as unknown as Node;

                Reflector.source = modSource;
                Reflector.ast = ast;

                Reflector.extractClassesFromAst(ast, modSource);
                Reflector.extractEnumsFromAst(ast, modSource);
            } catch (err: any) {
                console.error('[Reflector] Error parsing module AST:', err.message);
            }
        }

        // Load the hooks
        Reflector.findHooksBySignature();

        // Save the hooks
        await Reflector.saveHooks();
    }

    // Load the hooks from the database
    static async loadHooksFromDB(): Promise<void> {
        try {
            if (typeof indexedDB === 'undefined') return;

            // Link the database
            const highliteResources = new HighliteResources();

            // Initialise
            await highliteResources.init();
            
            // Read from the client class hooks
            const clientClassHooks = await highliteResources.getItem<HookEntries>('clientClassHooks');

            // If we have stored enum hooks
            if (Array.isArray(clientClassHooks)) {
                // Rehydrate
                Reflector.classHooks = Reflector.deserializeHookEntries(clientClassHooks);
            }

            // Read from the client enum hooks
            const clientEnumHooks = await highliteResources.getItem<HookEntries>('clientEnumHooks');

            // If we have stored enum hooks
            if (Array.isArray(clientEnumHooks)) {
                // Rehydrate
                Reflector.enumHooks = Reflector.deserializeHookEntries(clientEnumHooks);
            }
        } catch (err: any) {
            console.warn('[Reflector] Failed to load hooks from DB:', err.message);
        }
    }

    // Save the hooks to the database
    private static async saveHooks(): Promise<void> {
        try {
            if (typeof indexedDB === 'undefined') return;

            // Link the database
            const highliteResources = new HighliteResources();

            // Initialise
            await highliteResources.init();

            // Save the class hooks
            await highliteResources.setItem('clientClassHooks', Reflector.serializeHookMap(Reflector.classHooks));
            
            // Save the enum hooks
            await highliteResources.setItem('clientEnumHooks', Reflector.serializeHookMap(Reflector.enumHooks));    
        } catch (err: any) {
            console.warn('[Reflector] Failed to save hooks to DB:', err.message);
        }
    }

    // Check if we have any previously saved hooks
    static async hasSavedHooks(): Promise<boolean> {
        try {
            if (typeof indexedDB === 'undefined') return false;

            // Link the database
            const highliteResources = new HighliteResources();

            // Initialise
            await highliteResources.init();

            // Read the stored class hooks
            const clientClassHooks = await highliteResources.getItem<HookEntries>('clientClassHooks');

            // Read the stored enum hooks
            const clientEnumHooks = await highliteResources.getItem<HookEntries>('clientEnumHooks');

            // Return true if either collection has at least one entry
            const classCount = Array.isArray(clientClassHooks) ? clientClassHooks.length : 0;
            const enumCount = Array.isArray(clientEnumHooks) ? clientEnumHooks.length  : 0;

            return (classCount + enumCount) > 0;
        } catch (err: any) {
            console.warn('[Reflector] Failed to check saved hooks:', err.message);
            return false;
        }
    }

    // Extract the classes from an AST
    private static extractClassesFromAst(ast: Node, source: string): ClassInfo[] {
        walk.simple(ast, {
            ClassDeclaration(node: any) {
                const c: ClassInfo = {
                    name: node.id?.name ?? '',
                    staticFields: [],
                    instanceFields: [],
                    staticMethods: [],
                    instanceMethods: [],
                    start: node.start,
                    end: node.end,
                    source: source.slice(node.start, node.end)
                };

                for (const m of node.body.body) {
                    if (m.type === 'MethodDefinition') {
                        const list = m.static
                            ? c.staticMethods
                            : c.instanceMethods;
                        list.push({ name: m.key.name, kind: m.kind });
                    } else if (m.type === 'PropertyDefinition' || m.type === 'ClassProperty') {
                        const list = m.static
                            ? c.staticFields
                            : c.instanceFields;
                        if (m.key?.name) list.push(m.key.name);
                    }
                }

                Reflector.classes.push(c);
            }
        });
        return Reflector.classes;
    }

    // Extract the classes from the AST
    private static extractClasses(): ClassInfo[] {
        if (Reflector.ast && Reflector.source) {
            return Reflector.extractClassesFromAst(Reflector.ast, Reflector.source);
        }
        return Reflector.classes;
    }

    // Extract the enums from an AST
    private static extractEnumsFromAst(ast: Node, _source: string): EnumInfo[] {
        walk.simple(ast, {
            // Modern Object and Array expressions
            VariableDeclarator(node: any) {
                if (node.id?.type === 'Identifier') {
                    const varName = node.id.name;
                    if (node.init?.type === 'ObjectExpression') {
                        const memberSet = new Set<string>();
                        for (const prop of node.init.properties) {
                            if (prop.type === 'Property') {
                                const k = prop.key?.name || (prop.key?.type === 'Literal' ? String(prop.key.value) : null);
                                const v = prop.value?.type === 'Literal' ? String(prop.value.value) : null;
                                if (k) memberSet.add(k.toLowerCase());
                                if (v) memberSet.add(v.toLowerCase());
                            }
                        }
                        if (memberSet.size >= 2) {
                            Reflector.enums.push({
                                name: varName,
                                members: Array.from(memberSet),
                                start: node.start,
                                end: node.end
                            });
                        }
                    } else if (node.init?.type === 'ArrayExpression') {
                        const memberSet = new Set<string>();
                        for (const el of node.init.elements) {
                            if (el?.type === 'Literal' && typeof el.value === 'string') {
                                memberSet.add(el.value.toLowerCase());
                            }
                        }
                        if (memberSet.size >= 2) {
                            Reflector.enums.push({
                                name: varName,
                                members: Array.from(memberSet),
                                start: node.start,
                                end: node.end
                            });
                        }
                    }
                }
            },
            // Pattern 1: !function(e){ ... }(E || (E = {}));
            CallExpression(node: any) {
                if (node.arguments.length !== 1) return;
                const arg = node.arguments[0];
                if (arg.type !== 'LogicalExpression' || arg.operator !== '||') return;
                if (arg.left.type !== 'Identifier') return;

                let assign;
                if (arg.right.type === 'AssignmentExpression') assign = arg.right;
                else if (arg.right.type === 'ParenthesizedExpression'
                    && arg.right.expression.type === 'AssignmentExpression')
                    assign = arg.right.expression;
                else if (arg.right.type === 'ObjectExpression') {
                    assign = { left: { name: arg.left.name } };
                }
                if (!assign) return;
                if (assign.left.type && assign.left.type !== 'Identifier') return;
                if (assign.left.name !== arg.left.name) return;

                const callee = node.callee;
                if (callee.type !== 'FunctionExpression' && callee.type !== 'ArrowFunctionExpression') return;

                const memberSet = new Set<string>();
                walk.simple(callee.body, {
                    Literal(l: any) {
                        if (typeof l.value === 'string') memberSet.add(l.value.toLowerCase());
                    }
                });

                if (!memberSet.size) return;

                const e: EnumInfo = {
                    name: arg.left.name,
                    members: Array.from(memberSet),
                    start: node.start,
                    end: node.end
                };

                Reflector.enums.push(e);
            }
        });
        return Reflector.enums;
    }

    // Extract the enums from the AST
    private static extractEnums(): EnumInfo[] {
        if (Reflector.ast && Reflector.source) {
            return Reflector.extractEnumsFromAst(Reflector.ast, Reflector.source);
        }
        return Reflector.enums;
    }

    // Find the hooks using the hook signatures
    private static findHooksBySignature() {

        // Iterate through each of the class hooks
        for (const [name, signature] of ClassSignatures) {

            // Attempt to resolve the hook
            const hook = Reflector.findClassBySignature(signature);

            // Check if we had success
            if (hook) {

                // Bind it to the hooks
                Reflector.classHooks.set(name, hook.name);

                // Log to console
                console.log(`[Reflector] Successfully matched ${name} as ${hook.name}`);
                
            } else console.error(`[Reflector] Unable to find ${name}`);
        }

        // Iterate through each of the enum hooks
        for (const [name, signature] of EnumSignatures) {

            // Attempt to resolve the hook
            const hook = Reflector.findEnumBySignature(signature);

            // Check if we had success
            if (hook) {

                // Bind it to the hooks
                Reflector.enumHooks.set(name, hook.name);

                // Log to console
                console.log(`[Reflector] Successfully matched ${name} as ${hook.name}`);

            } else console.error(`[Reflector] Unable to find ${name}`);
        }
    }

    // Find a class based on signature
    // NOTE: Keep this public so easier to develop hooks for new features
    static findClassBySignature(signature : ClassSignature) : ClassInfo | undefined {

        // Return the class with the required signature
        return Reflector.classes.find(c => {

            // If fields are set check them
            if (signature.fields) {

                // Return false if the fields aren't all matched
                const fieldSet = new Set([...c.staticFields, ...c.instanceFields]);
                if (!signature.fields.every(f => fieldSet.has(f))) return false;
            }

            // If methods are set check them
            if (signature.methods) {

                // Return false if the methods aren't all matched
                const methodSet = new Set([
                ...c.staticMethods.map(m => m.name),
                ...c.instanceMethods.map(m => m.name),
                ]);
                if (!signature.methods.every(m => methodSet.has(m))) return false;
            }

            // If the signature textual match is set
            if (signature.contains) {
                const src = c.source ?? (Reflector.source ? Reflector.source.slice(c.start, c.end) : '');
                // Return false if the string doesn't contain the text
                if (src.indexOf(signature.contains) < 0) return false;
            }

            // Return true as all checks passed
            return true;
        });
    }

    // Function to find a statement by signature
    // NOTE: Keep this public so easier to develop hooks for new features
    static findEnumBySignature(signature: EnumSignature): EnumInfo | undefined {
        const lowerIncludes = signature.includes.map(s => s.toLowerCase());
        const lowerExcludes = signature.excludes?.map(s => s.toLowerCase());

        // Return the enum with the required signature
        return Reflector.enums.find(e => {
            const memberSet = new Set(e.members.map(m => m.toLowerCase()));

            // Return false if we can't find all the enum's expected fields
            if (!lowerIncludes.every(m => memberSet.has(m))) return false;

            // Return false if we have any of the excluded fields
            if (lowerExcludes && lowerExcludes.some(x => memberSet.has(x))) return false;

            // Return true if all checks pass
            return true;
        });
    }

    // Get a hook from the registry
    static getClassHook(name: string): string | undefined {
        return Reflector.classHooks.get(name);
    }

    // Get a hook from the registry
    static getEnumHook(name: string): string | undefined {
        return Reflector.enumHooks.get(name);
    }

    // Bind the class hooks to the hook manager
    static bindClassHooks(hookManager: HookManager) {

        // Iterate through all the class hooks
        for (const [name, hook] of Reflector.classHooks.entries()) {

            console.debug(name, hook)

            // Register the class hook on the manager
            hookManager.registerClass(hook, name)
        }
    }

    // Bind the enum hooks to the hook manager
    static bindEnumHooks(hookManager: HookManager) {

        // Iterate through all the enum hooks
        for (const [name, hook] of Reflector.enumHooks.entries()) {

            // Register the class hook on the manager
            hookManager.registerEnum(hook, name)
        }
    }

    // Convert a HookMap to its serializable tuple form
    private static serializeHookMap(map: HookMap): HookEntries {
        return Array.from(map.entries());
    }

    // Convert serialized entries back into a HookMap
    private static deserializeHookEntries(entries: HookEntries | null | undefined): HookMap {
        return new Map(entries ?? []);
    }
}
