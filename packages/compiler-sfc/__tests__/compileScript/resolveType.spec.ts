import { TSTypeAliasDeclaration } from '@babel/types'
import { parse } from '../../src'
import { ScriptCompileContext } from '../../src/script/context'
import {
  inferRuntimeType,
  recordImports,
  resolveTypeElements
} from '../../src/script/resolveType'

describe('resolveType', () => {
  test('type literal', () => {
    const { props, calls } = resolve(`type Target = {
      foo: number // property
      bar(): void // method
      'baz': string // string literal key
      (e: 'foo'): void // call signature
      (e: 'bar'): void
    }`)
    expect(props).toStrictEqual({
      foo: ['Number'],
      bar: ['Function'],
      baz: ['String']
    })
    expect(calls?.length).toBe(2)
  })

  test('reference type', () => {
    expect(
      resolve(`
    type Aliased = { foo: number }
    type Target = Aliased
    `).props
    ).toStrictEqual({
      foo: ['Number']
    })
  })

  test('reference exported type', () => {
    expect(
      resolve(`
    export type Aliased = { foo: number }
    type Target = Aliased
    `).props
    ).toStrictEqual({
      foo: ['Number']
    })
  })

  test('reference interface', () => {
    expect(
      resolve(`
    interface Aliased { foo: number }
    type Target = Aliased
    `).props
    ).toStrictEqual({
      foo: ['Number']
    })
  })

  test('reference exported interface', () => {
    expect(
      resolve(`
    export interface Aliased { foo: number }
    type Target = Aliased
    `).props
    ).toStrictEqual({
      foo: ['Number']
    })
  })

  test('reference interface extends', () => {
    expect(
      resolve(`
    export interface A { a(): void }
    export interface B extends A { b: boolean }
    interface C { c: string }
    interface Aliased extends B, C { foo: number }
    type Target = Aliased
    `).props
    ).toStrictEqual({
      a: ['Function'],
      b: ['Boolean'],
      c: ['String'],
      foo: ['Number']
    })
  })

  test('function type', () => {
    expect(
      resolve(`
    type Target = (e: 'foo') => void
    `).calls?.length
    ).toBe(1)
  })

  test('reference function type', () => {
    expect(
      resolve(`
    type Fn = (e: 'foo') => void
    type Target = Fn
    `).calls?.length
    ).toBe(1)
  })

  test('intersection type', () => {
    expect(
      resolve(`
    type Foo = { foo: number }
    type Bar = { bar: string }
    type Baz = { bar: string | boolean }
    type Target = { self: any } & Foo & Bar & Baz
    `).props
    ).toStrictEqual({
      self: ['Unknown'],
      foo: ['Number'],
      // both Bar & Baz has 'bar', but Baz['bar] is wider so it should be
      // preferred
      bar: ['String', 'Boolean']
    })
  })

  // #7553
  test('union type', () => {
    expect(
      resolve(`
    interface CommonProps {
      size?: 'xl' | 'l' | 'm' | 's' | 'xs'
    }

    type ConditionalProps =
      | {
          color: 'normal' | 'primary' | 'secondary'
          appearance: 'normal' | 'outline' | 'text'
        }
      | {
          color: number
          appearance: 'outline'
          note: string
        }

    type Target = CommonProps & ConditionalProps
    `).props
    ).toStrictEqual({
      size: ['String'],
      color: ['String', 'Number'],
      appearance: ['String'],
      note: ['String']
    })
  })

  test('template string type', () => {
    expect(
      resolve(`
    type T = 'foo' | 'bar'
    type S = 'x' | 'y'
    type Target = {
      [\`_\${T}_\${S}_\`]: string
    }
    `).props
    ).toStrictEqual({
      _foo_x_: ['String'],
      _foo_y_: ['String'],
      _bar_x_: ['String'],
      _bar_y_: ['String']
    })
  })

  test('mapped types w/ string manipulation', () => {
    expect(
      resolve(`
    type T = 'foo' | 'bar'
    type Target = { [K in T]: string | number } & {
      [K in 'optional']?: boolean
    } & {
      [K in Capitalize<T>]: string
    } & {
      [K in Uppercase<Extract<T, 'foo'>>]: string
    } & {
      [K in \`x\${T}\`]: string
    }
    `).props
    ).toStrictEqual({
      foo: ['String', 'Number'],
      bar: ['String', 'Number'],
      Foo: ['String'],
      Bar: ['String'],
      FOO: ['String'],
      xfoo: ['String'],
      xbar: ['String'],
      optional: ['Boolean']
    })
  })

  test('utility type: Pick', () => {
    expect(
      resolve(`
    type T = { foo: number, bar: string, baz: boolean }
    type K = 'foo' | 'bar'
    type Target = Pick<T, K>
    `).props
    ).toStrictEqual({
      foo: ['Number'],
      bar: ['String']
    })
  })

  test('utility type: Omit', () => {
    expect(
      resolve(`
    type T = { foo: number, bar: string, baz: boolean }
    type K = 'foo' | 'bar'
    type Target = Omit<T, K>
    `).props
    ).toStrictEqual({
      baz: ['Boolean']
    })
  })

  test('indexed access type', () => {
    expect(
      resolve(`
    type T = { bar: number }
    type S = { nested: { foo: T['bar'] }}
    type Target = S['nested']
    `).props
    ).toStrictEqual({
      foo: ['Number']
    })
  })

  test('namespace', () => {
    expect(
      resolve(`
      type X = string
      namespace Foo {
        type X = number
        export namespace Bar {
          export type A = {
            foo: X
          }
        }
      }
      type Target = Foo.Bar.A
    `).props
    ).toStrictEqual({
      foo: ['Number']
    })
  })

  describe('external type imports', () => {
    test('relative ts', () => {
      expect(
        resolve(
          `
        import { P } from './foo'
        import { Y as PP } from './bar'
        type Target = P & PP
        `,
          {
            'foo.ts': 'export type P = { foo: number }',
            'bar.d.ts': 'type X = { bar: string }; export { X as Y }'
          }
        ).props
      ).toStrictEqual({
        foo: ['Number'],
        bar: ['String']
      })
    })

    test('relative vue', () => {
      expect(
        resolve(
          `
        import { P } from './foo.vue'
        import { P as PP } from './bar.vue'
        type Target = P & PP
        `,
          {
            'foo.vue':
              '<script lang="ts">export type P = { foo: number }</script>',
            'bar.vue':
              '<script setup lang="tsx">export type P = { bar: string }</script>'
          }
        ).props
      ).toStrictEqual({
        foo: ['Number'],
        bar: ['String']
      })
    })

    test('relative (chained)', () => {
      expect(
        resolve(
          `
        import { P } from './foo'
        type Target = P
        `,
          {
            'foo.ts': `import type { P as PP } from './nested/bar.vue'
              export type P = { foo: number } & PP`,
            'nested/bar.vue':
              '<script setup lang="ts">export type P = { bar: string }</script>'
          }
        ).props
      ).toStrictEqual({
        foo: ['Number'],
        bar: ['String']
      })
    })

    test('relative (chained, re-export)', () => {
      expect(
        resolve(
          `
        import { PP as P } from './foo'
        type Target = P
        `,
          {
            'foo.ts': `export { P as PP } from './bar'`,
            'bar.ts': 'export type P = { bar: string }'
          }
        ).props
      ).toStrictEqual({
        bar: ['String']
      })
    })
  })

  describe('errors', () => {
    test('failed type reference', () => {
      expect(() => resolve(`type Target = X`)).toThrow(
        `Unresolvable type reference`
      )
    })

    test('unsupported computed keys', () => {
      expect(() => resolve(`type Target = { [Foo]: string }`)).toThrow(
        `Unsupported computed key in type referenced by a macro`
      )
    })

    test('unsupported index type', () => {
      expect(() => resolve(`type Target = X[K]`)).toThrow(
        `Unsupported index type`
      )
    })

    test('failed improt source resolve', () => {
      expect(() =>
        resolve(`import { X } from './foo'; type Target = X`)
      ).toThrow(`Failed to resolve import source "./foo" for type X`)
    })
  })
})

function resolve(code: string, files: Record<string, string> = {}) {
  const { descriptor } = parse(`<script setup lang="ts">\n${code}\n</script>`, {
    filename: 'Test.vue'
  })
  const ctx = new ScriptCompileContext(descriptor, {
    id: 'test',
    fs: {
      fileExists(file) {
        return !!files[file]
      },
      readFile(file) {
        return files[file]
      }
    }
  })

  // ctx.userImports is collected when calling compileScript(), but we are
  // skipping that here, so need to manually register imports
  ctx.userImports = recordImports(ctx.scriptSetupAst!.body) as any

  const targetDecl = ctx.scriptSetupAst!.body.find(
    s => s.type === 'TSTypeAliasDeclaration' && s.id.name === 'Target'
  ) as TSTypeAliasDeclaration
  const raw = resolveTypeElements(ctx, targetDecl.typeAnnotation)
  const props: Record<string, string[]> = {}
  for (const key in raw.props) {
    props[key] = inferRuntimeType(ctx, raw.props[key])
  }
  return {
    props,
    calls: raw.calls,
    raw
  }
}
