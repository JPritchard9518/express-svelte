'use strict';

const sourceMapSupport = require('source-map-support');
const nodeEval = require('eval')

const rollup = require('rollup');
const replace = require('@rollup/plugin-replace');
const { nodeResolve } = require('@rollup/plugin-node-resolve');
const commonjs = require('@rollup/plugin-commonjs');
const svelte = require('rollup-plugin-svelte');

const NODE_ENV = process.env.NODE_ENV;
const NODE_ENV_DEVELOPMENT = 'development';
const NODE_ENV_TESTING = 'testing';

const ERROR_EXPRESS_SVELTE_COMPILE_OUTPUT_INVALID_LENGTH = 'ERROR_EXPRESS_SVELTE_COMPILE_OUTPUT_INVALID_LENGTH';
const ERROR_EXPRESS_SVELTE_COMPILE_OUTPUT_INVALID_TYPE = 'ERROR_EXPRESS_SVELTE_COMPILE_OUTPUT_INVALID_TYPE';

let _cacheMap = new Map();
let _installedSourceMapSupport = false;

class ViewCompiler {

    static clearCache() {
        _cacheMap = new Map();
    }

    /**
     * @param {String} filename
     * @param {ExpressSvelteCompileOptions} [opts]
     * @return {Promise.<Function>}
     */
    static async compile(filename, opts = {}) {

        const env = opts.env || NODE_ENV || NODE_ENV_DEVELOPMENT;
        const dev = opts.dev != null ? opts.dev : env === NODE_ENV_DEVELOPMENT || env === NODE_ENV_TESTING;
        const cache = opts.cache != null ? opts.cache : dev === false;
        const hydratable = opts.hydratable != null ? opts.hydratable : true;
        const replaceOpts = opts.replace || {};
        const preprocess = opts.preprocess || [];
        const dedupe = opts.dedupe || [];

        let cacheKey = null;

        if (cache === true) {
            // Hydratable is the only config options that can change at runtime after main config is set
            cacheKey = `${filename}|hydratable:${hydratable}`;
            const compiled = _cacheMap.get(cacheKey);

            if (compiled != null) {
                return compiled;
            }
        }

        const inputOptions = {
            cache: false,
            input: filename,
            plugins: [
                replace({
                    'process.browser': false,
                    'process.env.NODE_ENV': env,
                    ...replaceOpts
                }),
                svelte({
                    generate: 'ssr',
                    hydratable,
                    dev,
                    preserveComments: dev,
                    preserveWhitespace: dev,
                    preprocess,
                    css: false
                }),
                nodeResolve({
                    dedupe: [
                        'svelte',
                        'svelte/animate',
                        'svelte/easing',
                        'svelte/internal',
                        'svelte/motion',
                        'svelte/store',
                        'svelte/transition',
                        ...dedupe
                    ]
                }),
                commonjs()
            ],
            preserveEntrySignatures: 'strict'
        };

        const outputOptions = {
            format: 'cjs',
            exports: 'auto',
            sourcemap: dev === true ? 'inline' : false,
        };

        const bundle = await rollup.rollup(inputOptions);
        const { output } = await bundle.generate(outputOptions);

        if (output.length !== 1) {
            const err = new Error(`Invalid compile output. Generated more than one chunk or asset. filename:${filename} output.length:${output.length}`);
            err.code = ERROR_EXPRESS_SVELTE_COMPILE_OUTPUT_INVALID_LENGTH;
            throw err;
        }

        const chunk = output[0];

        if (chunk.type !== 'chunk') {
            const err = new Error(`Invalid compile output. Generated an asset instead of a chunk. filename:${filename}`);
            err.code = ERROR_EXPRESS_SVELTE_COMPILE_OUTPUT_INVALID_TYPE;
            throw err;
        }

        // Add source map if apply
        const code = dev === true && chunk.map != null ? `${chunk.code}\n//# sourceMappingURL=${chunk.map.toUrl()}` : chunk.code;

        // If dev is enabled, we add sourcemap support for debugging
        if (dev === true) {
            _installSourceMapSupport();
        }

        // Eval (require from string) and return compiled component
        const compiled = nodeEval(code);

        if (cache === true) {
            _cacheMap.set(cacheKey, compiled);
        }

        return compiled;
    }
}

function _installSourceMapSupport() {
    if (_installedSourceMapSupport === true) {
        return;
    }

    _installedSourceMapSupport = true;

    sourceMapSupport.install({
        handleUncaughtExceptions: false,
        environment: 'node'
    });
}

module.exports = ViewCompiler