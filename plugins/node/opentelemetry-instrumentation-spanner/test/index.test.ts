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

import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import type { AsyncHooksContextManager } from '@opentelemetry/context-async-hooks';
import {
    InMemorySpanExporter,
    SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import type * as Spanner from '@google-cloud/spanner';
import * as assert from 'assert';
import { SpannerInstrumentation } from '../src';

const projectId = process.env.GCLOUD_PROJECT || 'test-project';

const instrumentation = new SpannerInstrumentation();
const exporter = new InMemorySpanExporter();

describe('Creation', () => {
    const provider = new NodeTracerProvider);
    const tracer = provider.getTracer('default');
    provider.addSpanProcessor(new SimpleSpanProcessor(exporter));
    instrumentation.setTracerProvider(provider);
    let contextManager: AsyncHooksContextManager;

    beforeEach(() => {
        contextManager = new AsyncHooksContextManager();
        context.setGlobalContextManager(contextManager.enable());
        instrumentation.setConfig({});
        instrumentation.enable();
    });

    afterEach(() => {
        exporter.reset();
        context.disable();
        instrumentation.disable();
    });

    const {Spanner} = require('@google-cloud/spanner');
    const spanner = new Spanner({
        projectId: projectId,
    });

    it('Initialize and query', async() => {
        const instance = spanner.instance('test-instance');
        const database = instance('test-db');

        const [rows] = await database.run('SELECT CURRENT_TIMESTAMP()');
    });
});
