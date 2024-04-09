# TypeScript Plugin - Emit Decorator Metadata

Based on https://github.com/microsoft/TypeScript/issues/57533 and https://github.com/microsoft/TypeScript/pull/58101 - utilising https://github.com/nonara/ts-patch to add design time type reflection for ES decorator. 

```json
{
  "compilerOptions": {
    "plugins": [
      {
        "transform": "typescript-plugin-emit-decorator-metadata"
      }
    ],
  }
}
```

```ts
function inject(_, context) {
  context.metadata[design:typeinfo].type
  //                                ^? () => Dependency
}

class Application {
  @inject
  private readonly dependency!: Dependency;
}
```

```js
"use strict";
var __esMetadata = (this && this.__esMetadata) || function (k, v) {
    return function (_, c) {
        c.metadata[k] = v;
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
class Application {
    @inject
    @__esMetadata("design:typeinfo", {
        type: () => Dependency
    })
    dependency;
}
```
