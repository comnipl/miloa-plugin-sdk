# @comnipl/miloa-plugin-sdk

Build View plugins for [Miloa](https://miloa.io). A plugin is a React app bundled into one `.miloaplugin` file. Miloa runs it in a sandboxed iframe as a custom view and passes workspace data over an RPC channel.

- `@comnipl/miloa-plugin-sdk`: the client that talks to the host.
- `@comnipl/miloa-plugin-sdk/react`: the provider and the hooks for entries, tags, and live updates.
- `@comnipl/miloa-plugin-sdk/vite`: `miloaPlugin()`, which builds the `.miloaplugin` file.
- `@comnipl/miloa-plugin-sdk/testing`: a host stand-in for tests.
- `miloa-plugin dev`: a CLI that previews the plugin in a Miloa workspace.

```sh
pnpm add @comnipl/miloa-plugin-sdk react react-dom
pnpm add -D vite
```

## Documentation

- [Getting started](https://developers.miloa.io/plugins/getting-started/) ([for LLMs](https://developers.miloa.io/plugins/getting-started.md))
- [Concepts](https://developers.miloa.io/plugins/concepts/) ([for LLMs](https://developers.miloa.io/plugins/concepts.md))
- [Reference](https://developers.miloa.io/plugins/reference/) ([for LLMs](https://developers.miloa.io/plugins/reference.md))
- [Upload a plugin](https://developers.miloa.io/plugins/upload/) ([for LLMs](https://developers.miloa.io/plugins/upload.md))

The source is mirrored to [comnipl/miloa-plugin-sdk](https://github.com/comnipl/miloa-plugin-sdk). Licensed under Apache-2.0.
