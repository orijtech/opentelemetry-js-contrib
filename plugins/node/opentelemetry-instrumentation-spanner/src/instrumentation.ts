/*
 * Copyright The OpenTelemetry Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import {
    InstrumentationBase,
    InstrumentationNodeModuleDefinition,
    isWrapped,
} from '@opentelemetry/instrumentation';
import {
    SEMATTRS_DB_SQL_TABLE,
    SEMATTRS_DB_STATEMENT,
    SEMATTRS_DB_SYSTEM,
} from '@opentelemetry/semantic-conventions';
import {
  Span,
  SpanStatusCode,
  Context,
  context,
  trace,
  SpanKind,
} from '@opentelemetry/api';
import {PACKAGE_NAME, PACKAGE_VERSION} from './version';
import type * as spannerTypes from '@google-cloud/spanner';
import {SpannerInstrumentationConfig} from './types';

let optedInPII: boolean =
  process.env.SPANNER_ENABLE_EXTENDED_TRACING === 'true';

interface SQLStatement {
  sql: string;
}

const {DiagConsoleLogger, DiagLogLevel, diag} = require('@opentelemetry/api');
diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.ALL);

export class SpannerInstrumentation extends InstrumentationBase<SpannerInstrumentationConfig> {
    static readonly COMMON_ATTRIBUTES = {
        SEMATTRS_DB_SYSTEM: "spanner",
    }

    constructor(config: SpannerInstrumentationConfig = {}) {
        super(PACKAGE_NAME, PACKAGE_VERSION, config);
    }

    protected init() {
        console.log('SpannerInstrumentation.init invoked');

        return [
            new InstrumentationNodeModuleDefinition(
                '@google-cloud/spanner',
                ['*'],
                (moduleExports: typeof spannerTypes) => {
                    if (isWrapped(moduleExports.Instance.database)) {
                        this._unwrap(moduleExports, 'Instance.database');
                    }
                    this._wrap(
                        moduleExports,
                        'Instance.database',
                        this._patchCreateDatabase() as any
                    );
                    this._wrap(
                        moduleExports,
                        'Instance.createDatabase',
                        this._patchCreateDatabase() as any
                    );

                    if (isWrapped(moduleExports.Database.run)) {
                        this._unwrap(moduleExports, 'Database.run');
                    }
                    this._wrap(
                        moduleExports,
                        'Database.run',
                        this._patchDatabaseRun() as any
                    );
                },
            ),
        ];
    }

    private _patchCreateDatabase() {
        console.log('_patchCreateDatabase');
        return (originalCreateDatabase: Function) => {
            const plugin = this;

            return function createDatabase() {
                const db = originalCreateDatabase(...arguments);

                plugin._wrap(
                    db,
                    'run',
                    plugin._patchDatabaseRun(db) as any
                );

                return db;
            };
        };
    }

    private _patchDatabaseBatchCreateSession(db: typeof spannerTypes.Database) {
        return (originalDatabaseBatchCreateSession: Function) => {
            const plugin = this;

            return function databaseBatchCreateSession() {
                if (!plugin.enabled()) {
                    plugin._unwrap(db, 'batchCreateSession');
                    return originalDatabaseBatchSession.apply(db, arguments);
                }
                
                const span = plugin.startTrace('Database.batchCreateSessions', {});
                const cbIndex = Array.from(arguments).findIndex(
                    arg => typeof arg === 'function'
                );

                if (cbIndex === -1) {
                }
            }
        };
    }

    private wrapPromise<T>(
        span: Span,
        promise: Promise<T>,
        onSuccess?: (span: Span, result: T) => void
    ) : Promise<T> {
        return promise.then(result => {
            return new Promise<T>(resolve => {
                if (onSuccess) {
                   onSuccess(span, result); 
                }
                span.end();
                resolve(result);
            })
        }).catch((err: Error) => {
            return new Promise<T>((_, reject) => {
                setSpanError(span, err);
                recordException(span, err);
                span.end();
                reject(err);
            });
        });
    }

    private enabled(): boolean {
        return this['_enabled'] === true;
    }

    private _patchDatabaseRun(db: typeof spannerTypes.Database) {
        return (originalDatabaseRun: Function) => {
            const plugin = this;

            return function databaseRun() {
                if (!plugin.enabled()) {
                    plugin._unwrap(db, 'run');
                    return originalDatabaseRun.apply(db, arguments);
                }

                const query = arguments[0] || '';
                const cbIndex = Array.from(arguments).findIndex(
                  arg => typeof arg === 'function'
                );
                const span = plugin.startTrace('Database.run', {sql: query});

                const parentContext = context.active();
                if (cbIndex === -1) { // We've got a promise not a callback.
                    const streamableQuery = context.with(trace.setSpan(context.active(), span), () => {
                        return originalDatabaseRun.apply(db, arguments);
                    });
                    context.bind(parentContext, streamableQuery);

                    return streamableQuery.on('error', err => {
                        setSpanError(span, err);
                    }).on('end', () => {
                        span.end();
                    });
                }

                // Here we've got a callback hence can wrap it differently.
                plugin._wrap(arguments, cbIndex, plugin._patchCallbackRun(span, parentContext));

                return context.with(trace.setSpan(context.active(), span), () => {
                    return originalDatabaseRun.apply(db, arguments);
                });
            }
        };
    }

    private _patchCallbackRun(span: Span, parentContext: Context) {
        return (originalCallback: Function) => {
            return (err: Error, rows: any) => {
                setSpanError(span, err);
                span.end();
                return context.with(parentContext, () => {
                    originalCallback(...arguments);
                });
            };
        };
    }

    private startTrace(spanNameSuffix: string, opts: {tableName?: string, sql?: string | SQLStatement}): Span {
      const span = this.tracer.startSpan('CloudSpanner.' + spanNameSuffix,
                                    {kind: SpanKind.CLIENT});

      if (opts.tableName) {
        span.setAttribute(SEMATTRS_DB_SQL_TABLE, opts.tableName);
      }

      const definedExtendedTracing = this._config.enableExtendedTracing !== undefined;
      // If they optedInPII but opts.enableExtendedTracing=false, reject it.
      const explicitlySkipET =
        definedExtendedTracing && !this._config.enableExtendedTracing;
      if (
        opts.sql &&
        !explicitlySkipET &&
        (this._config.enableExtendedTracing || optedInPII)
      ) {
        const sql = opts.sql;
        if (typeof sql === 'string') {
          span.setAttribute(SEMATTRS_DB_STATEMENT, sql as string);
        } else {
          const stmt = sql as SQLStatement;
          span.setAttribute(SEMATTRS_DB_STATEMENT, stmt.sql);
        }
      }

      return span;
    }
}

// setSpanError sets err, if non-nil onto the span with
// status.code=ERROR and the message of err.toString()
function setSpanError(span: Span, err: Error | String) {
  if (!err || !span) {
    return;
  }

  span.setStatus({
    code: SpanStatusCode.ERROR,
    message: err.toString(),
  });
}

function recordException(span: Span, err: Error | String) {
    if (!err || !span) {
        return;
    }
    span.recordException(err);
}
