import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    cli: 'src/cli/main.ts',
  },
  platform: 'node',
  dts: {
    generator: 'tsgo',
  },
  exports: true,
})
