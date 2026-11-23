# Miloa Plugin SDK

Build View plugins for Miloa with `@comnipl/miloa-plugin-sdk` and `@comnipl/miloa-plugin-contract`. This repository mirrors the source maintained in the Miloa repository.

## Documentation

- [Getting started](https://developers.miloa.io/plugins/getting-started/) ([for LLMs](https://developers.miloa.io/plugins/getting-started.md))
- [Concepts](https://developers.miloa.io/plugins/concepts/) ([for LLMs](https://developers.miloa.io/plugins/concepts.md))
- [Reference](https://developers.miloa.io/plugins/reference/) ([for LLMs](https://developers.miloa.io/plugins/reference.md))
- [Upload a plugin](https://developers.miloa.io/plugins/upload/) ([for LLMs](https://developers.miloa.io/plugins/upload.md))

LLMs can also start from [llms.txt](https://developers.miloa.io/llms.txt), which lists every page of the developer docs.

## Packages

- [`@comnipl/miloa-plugin-sdk`](packages/plugin-sdk/): the client, React hooks, the Vite plugin, and the `miloa-plugin` CLI.
- [`@comnipl/miloa-plugin-contract`](packages/plugin-contract/): the data and protocol types the SDK and the host share.

See the [minimal example](examples/minimal/). The SDK and examples are licensed under [Apache-2.0](LICENSE).
