## OpenTelemetry Cloud Spanner instrumentation for Node.js

This module provides automatic instrumentation for the [Cloud Spanner](https://www.npmjs.com/package/@google-cloud/spanner) module, which may be loaded using the 

### Installation

```shell
npm install --save @opentelemetry/instrumentation-spanner
```

### Usage
This instrumentation allows the user to automatically extract trace data and export it to your backend of choice, giving observability
to distributed systems when using Google Cloud Spanner.

To load the plugin, please specify in `registerInstrumentations` configuration like this

```javascript
const {NodeTracerProvider} = require('@opentelemetry/sdk-trace-node');
const {SpannerInstrumentation} = require('@opentelemetry/instrumentation-spanner');
const {registerInstrumentations} = require('@opentelemetry/instrumentation');

const provider = new NodeTracerProvider();
provider.register();

registerInstrumentations({
    instrumentations: [
        new SpannerInstrumentation(),
    ],
});
```

### Configuration options

Option|Type|Default|Description
---|---|---|---
enableExtendedTracing|boolean|false|If enabled, allows annotating spans with the SQL being ran.


### Semantic conventions

This package uses `opentelemetry/semantic-conventions`, which implements [Semantic Conventions Version 1.7.0]() and collects the
following attributes.

Attribute|Description
---|---
db.system|"spanner" as always the value being used to describe the database management system being used
db.statement|If `SPANNER_ENABLE_EXTENDED_TRACING=true` is set in your environment, or if the instrumentation configuration option `enableExtendedTracing: true` is enabled

### License
Google LLC using the Apache 2.0 -- See [LICENSE](./LICENSE) for more information.
