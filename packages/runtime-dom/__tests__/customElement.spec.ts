import {
  ComponentOptions,
  defineAsyncComponent,
  defineComponent,
  defineCustomElement,
  h,
  inject,
  nextTick,
  Ref,
  ref,
  renderSlot,
  VueElement
} from '../src'
import { expect } from 'vitest'

describe('defineCustomElement', () => {
  const container = document.createElement('div')
  document.body.appendChild(container)

  beforeEach(() => {
    container.innerHTML = ''
  })

  describe('mounting/unmount', () => {
    const E = defineCustomElement({
      props: {
        msg: {
          type: String,
          default: 'hello'
        }
      },
      render() {
        return h('div', this.msg)
      }
    })
    customElements.define('my-element', E)

    test('should work', () => {
      container.innerHTML = `<my-element></my-element>`
      const e = container.childNodes[0] as VueElement
      expect(e).toBeInstanceOf(E)
      expect(e._instance).toBeTruthy()
      expect(e.shadowRoot!.innerHTML).toBe(`<div>hello</div>`)
    })

    test('should work w/ manual instantiation', () => {
      const e = new E({ msg: 'inline' })
      // should lazy init
      expect(e._instance).toBe(null)
      // should initialize on connect
      container.appendChild(e)
      expect(e._instance).toBeTruthy()
      expect(e.shadowRoot!.innerHTML).toBe(`<div>inline</div>`)
    })

    test('should unmount on remove', async () => {
      container.innerHTML = `<my-element></my-element>`
      const e = container.childNodes[0] as VueElement
      container.removeChild(e)
      await nextTick()
      expect(e._instance).toBe(null)
      expect(e.shadowRoot!.innerHTML).toBe('')
    })

    test('should not unmount on move', async () => {
      container.innerHTML = `<div><my-element></my-element></div>`
      const e = container.childNodes[0].childNodes[0] as VueElement
      const i = e._instance
      // moving from one parent to another - this will trigger both disconnect
      // and connected callbacks synchronously
      container.appendChild(e)
      await nextTick()
      // should be the same instance
      expect(e._instance).toBe(i)
      expect(e.shadowRoot!.innerHTML).toBe('<div>hello</div>')
    })

    test('remove then insert again', async () => {
      container.innerHTML = `<my-element></my-element>`
      const e = container.childNodes[0] as VueElement
      container.removeChild(e)
      await nextTick()
      expect(e._instance).toBe(null)
      expect(e.shadowRoot!.innerHTML).toBe('')
      container.appendChild(e)
      expect(e._instance).toBeTruthy()
      expect(e.shadowRoot!.innerHTML).toBe('<div>hello</div>')
    })
  })

  describe('props', () => {
    const E = defineCustomElement({
      props: ['foo', 'bar', 'bazQux'],
      render() {
        return [
          h('div', null, this.foo),
          h('div', null, this.bazQux || (this.bar && this.bar.x))
        ]
      }
    })
    customElements.define('my-el-props', E)

    test('props via attribute', async () => {
      // bazQux should map to `baz-qux` attribute
      container.innerHTML = `<my-el-props foo="hello" baz-qux="bye"></my-el-props>`
      const e = container.childNodes[0] as VueElement
      expect(e.shadowRoot!.innerHTML).toBe('<div>hello</div><div>bye</div>')

      // change attr
      e.setAttribute('foo', 'changed')
      await nextTick()
      expect(e.shadowRoot!.innerHTML).toBe('<div>changed</div><div>bye</div>')

      e.setAttribute('baz-qux', 'changed')
      await nextTick()
      expect(e.shadowRoot!.innerHTML).toBe(
        '<div>changed</div><div>changed</div>'
      )
    })

    test('props via properties', async () => {
      const e = new E()
      e.foo = 'one'
      e.bar = { x: 'two' }
      container.appendChild(e)
      expect(e.shadowRoot!.innerHTML).toBe('<div>one</div><div>two</div>')

      // reflect
      // should reflect primitive value
      expect(e.getAttribute('foo')).toBe('one')
      // should not reflect rich data
      expect(e.hasAttribute('bar')).toBe(false)

      e.foo = 'three'
      await nextTick()
      expect(e.shadowRoot!.innerHTML).toBe('<div>three</div><div>two</div>')
      expect(e.getAttribute('foo')).toBe('three')

      e.foo = null
      await nextTick()
      expect(e.shadowRoot!.innerHTML).toBe('<div></div><div>two</div>')
      expect(e.hasAttribute('foo')).toBe(false)

      e.bazQux = 'four'
      await nextTick()
      expect(e.shadowRoot!.innerHTML).toBe('<div></div><div>four</div>')
      expect(e.getAttribute('baz-qux')).toBe('four')
    })

    test('attribute -> prop type casting', async () => {
      const E = defineCustomElement({
        props: {
          fooBar: Number, // test casting of camelCase prop names
          bar: Boolean,
          baz: String
        },
        render() {
          return [
            this.fooBar,
            typeof this.fooBar,
            this.bar,
            typeof this.bar,
            this.baz,
            typeof this.baz
          ].join(' ')
        }
      })
      customElements.define('my-el-props-cast', E)
      container.innerHTML = `<my-el-props-cast foo-bar="1" baz="12345"></my-el-props-cast>`
      const e = container.childNodes[0] as VueElement
      expect(e.shadowRoot!.innerHTML).toBe(
        `1 number false boolean 12345 string`
      )

      e.setAttribute('bar', '')
      await nextTick()
      expect(e.shadowRoot!.innerHTML).toBe(`1 number true boolean 12345 string`)

      e.setAttribute('foo-bar', '2e1')
      await nextTick()
      expect(e.shadowRoot!.innerHTML).toBe(
        `20 number true boolean 12345 string`
      )

      e.setAttribute('baz', '2e1')
      await nextTick()
      expect(e.shadowRoot!.innerHTML).toBe(`20 number true boolean 2e1 string`)
    })

    // #4772
    test('attr casting w/ programmatic creation', () => {
      const E = defineCustomElement({
        props: {
          foo: Number
        },
        render() {
          return `foo type: ${typeof this.foo}`
        }
      })
      customElements.define('my-element-programmatic', E)
      const el = document.createElement('my-element-programmatic') as any
      el.setAttribute('foo', '123')
      container.appendChild(el)
      expect(el.shadowRoot.innerHTML).toBe(`foo type: number`)
    })

    test('handling properties set before upgrading', () => {
      const E = defineCustomElement({
        props: {
          foo: String,
          dataAge: Number
        },
        setup(props) {
          expect(props.foo).toBe('hello')
          expect(props.dataAge).toBe(5)
        },
        render() {
          return h('div', `foo: ${this.foo}`)
        }
      })
      const el = document.createElement('my-el-upgrade') as any
      el.foo = 'hello'
      el.dataset.age = 5
      el.notProp = 1
      container.appendChild(el)
      customElements.define('my-el-upgrade', E)
      expect(el.shadowRoot.firstChild.innerHTML).toBe(`foo: hello`)
      // should not reflect if not declared as a prop
      expect(el.hasAttribute('not-prop')).toBe(false)
    })

    test('handle properties set before connecting', () => {
      const obj = { a: 1 }
      const E = defineCustomElement({
        props: {
          foo: String,
          post: Object
        },
        setup(props) {
          expect(props.foo).toBe('hello')
          expect(props.post).toBe(obj)
        },
        render() {
          return JSON.stringify(this.post)
        }
      })
      customElements.define('my-el-preconnect', E)
      const el = document.createElement('my-el-preconnect') as any
      el.foo = 'hello'
      el.post = obj

      container.appendChild(el)
      expect(el.shadowRoot.innerHTML).toBe(JSON.stringify(obj))
    })

    // https://github.com/vuejs/core/issues/6163
    test('handle components with no props', async () => {
      const E = defineCustomElement({
        render() {
          return h('div', 'foo')
        }
      })
      customElements.define('my-element-noprops', E)
      const el = document.createElement('my-element-noprops')
      container.appendChild(el)
      await nextTick()
      expect(el.shadowRoot!.innerHTML).toMatchInlineSnapshot('"<div>foo</div>"')
    })

    // # 5793
    test('set number value in dom property', () => {
      const E = defineCustomElement({
        props: {
          'max-age': Number
        },
        render() {
          // @ts-ignore
          return `max age: ${this.maxAge}/type: ${typeof this.maxAge}`
        }
      })
      customElements.define('my-element-number-property', E)
      const el = document.createElement('my-element-number-property') as any
      container.appendChild(el)
      el.maxAge = 50
      expect(el.maxAge).toBe(50)
      expect(el.shadowRoot.innerHTML).toBe('max age: 50/type: number')
    })
  })

  describe('attrs', () => {
    const E = defineCustomElement({
      render() {
        return [h('div', null, this.$attrs.foo as string)]
      }
    })
    customElements.define('my-el-attrs', E)

    test('attrs via attribute', async () => {
      container.innerHTML = `<my-el-attrs foo="hello"></my-el-attrs>`
      const e = container.childNodes[0] as VueElement
      expect(e.shadowRoot!.innerHTML).toBe('<div>hello</div>')

      e.setAttribute('foo', 'changed')
      await nextTick()
      expect(e.shadowRoot!.innerHTML).toBe('<div>changed</div>')
    })

    test('non-declared properties should not show up in $attrs', () => {
      const e = new E()
      // @ts-ignore
      e.foo = '123'
      container.appendChild(e)
      expect(e.shadowRoot!.innerHTML).toBe('<div></div>')
    })
  })

  describe('emits', () => {
    const CompDef = defineComponent({
      setup(_, { emit }) {
        emit('created')
        return () =>
          h('div', {
            onClick: () => {
              emit('my-click', 1)
            },
            onMousedown: () => {
              emit('myEvent', 1) // validate hyphenation
            }
          })
      }
    })
    const E = defineCustomElement(CompDef)
    customElements.define('my-el-emits', E)

    test('emit on connect', () => {
      const e = new E()
      const spy = vi.fn()
      e.addEventListener('created', spy)
      container.appendChild(e)
      expect(spy).toHaveBeenCalled()
    })

    test('emit on interaction', () => {
      container.innerHTML = `<my-el-emits></my-el-emits>`
      const e = container.childNodes[0] as VueElement
      const spy = vi.fn()
      e.addEventListener('my-click', spy)
      e.shadowRoot!.childNodes[0].dispatchEvent(new CustomEvent('click'))
      expect(spy).toHaveBeenCalledTimes(1)
      expect(spy.mock.calls[0][0]).toMatchObject({
        detail: [1]
      })
    })

    // #5373
    test('case transform for camelCase event', () => {
      container.innerHTML = `<my-el-emits></my-el-emits>`
      const e = container.childNodes[0] as VueElement
      const spy1 = vi.fn()
      e.addEventListener('myEvent', spy1)
      const spy2 = vi.fn()
      // emitting myEvent, but listening for my-event. This happens when
      // using the custom element in a Vue template
      e.addEventListener('my-event', spy2)
      e.shadowRoot!.childNodes[0].dispatchEvent(new CustomEvent('mousedown'))
      expect(spy1).toHaveBeenCalledTimes(1)
      expect(spy2).toHaveBeenCalledTimes(1)
    })

    test('emit from within async component wrapper', async () => {
      const p = new Promise<typeof CompDef>(res => res(CompDef as any))
      const E = defineCustomElement(defineAsyncComponent(() => p))
      customElements.define('my-async-el-emits', E)
      container.innerHTML = `<my-async-el-emits></my-async-el-emits>`
      const e = container.childNodes[0] as VueElement
      const spy = vi.fn()
      e.addEventListener('my-click', spy)
      // this feels brittle but seems necessary to reach the node in the DOM.
      await customElements.whenDefined('my-async-el-emits')
      await nextTick()
      await nextTick()
      e.shadowRoot!.childNodes[0].dispatchEvent(new CustomEvent('click'))
      expect(spy).toHaveBeenCalled()
      expect(spy.mock.calls[0][0]).toMatchObject({
        detail: [1]
      })
    })
    // #7293
    test('emit in an async component wrapper with properties bound', async () => {
      const E = defineCustomElement(
        defineAsyncComponent(
          () => new Promise<typeof CompDef>(res => res(CompDef as any))
        )
      )
      customElements.define('my-async-el-props-emits', E)
      container.innerHTML = `<my-async-el-props-emits id="my_async_el_props_emits"></my-async-el-props-emits>`
      const e = container.childNodes[0] as VueElement
      const spy = vi.fn()
      e.addEventListener('my-click', spy)
      await customElements.whenDefined('my-async-el-props-emits')
      await nextTick()
      await nextTick()
      e.shadowRoot!.childNodes[0].dispatchEvent(new CustomEvent('click'))
      expect(spy).toHaveBeenCalled()
      expect(spy.mock.calls[0][0]).toMatchObject({
        detail: [1]
      })
    })
  })

  describe('slots', () => {
    const E = defineCustomElement({
      render() {
        return [
          h('div', null, [
            renderSlot(this.$slots, 'default', undefined, () => [
              h('div', 'fallback')
            ])
          ]),
          h('div', null, renderSlot(this.$slots, 'named'))
        ]
      }
    })
    customElements.define('my-el-slots', E)

    test('default slot', () => {
      container.innerHTML = `<my-el-slots><span>hi</span></my-el-slots>`
      const e = container.childNodes[0] as VueElement
      // native slots allocation does not affect innerHTML, so we just
      // verify that we've rendered the correct native slots here...
      expect(e.shadowRoot!.innerHTML).toBe(
        `<div><slot><div>fallback</div></slot></div><div><slot name="named"></slot></div>`
      )
    })
  })

  describe('provide/inject', () => {
    const Consumer = defineCustomElement({
      setup() {
        const foo = inject<Ref>('foo')!
        return () => h('div', foo.value)
      }
    })
    customElements.define('my-consumer', Consumer)

    test('over nested usage', async () => {
      const foo = ref('injected!')
      const Provider = defineCustomElement({
        provide: {
          foo
        },
        render() {
          return h('my-consumer')
        }
      })
      customElements.define('my-provider', Provider)
      container.innerHTML = `<my-provider><my-provider>`
      const provider = container.childNodes[0] as VueElement
      const consumer = provider.shadowRoot!.childNodes[0] as VueElement

      expect(consumer.shadowRoot!.innerHTML).toBe(`<div>injected!</div>`)

      foo.value = 'changed!'
      await nextTick()
      expect(consumer.shadowRoot!.innerHTML).toBe(`<div>changed!</div>`)
    })

    test('over slot composition', async () => {
      const foo = ref('injected!')
      const Provider = defineCustomElement({
        provide: {
          foo
        },
        render() {
          return renderSlot(this.$slots, 'default')
        }
      })
      customElements.define('my-provider-2', Provider)

      container.innerHTML = `<my-provider-2><my-consumer></my-consumer><my-provider-2>`
      const provider = container.childNodes[0]
      const consumer = provider.childNodes[0] as VueElement
      expect(consumer.shadowRoot!.innerHTML).toBe(`<div>injected!</div>`)

      foo.value = 'changed!'
      await nextTick()
      expect(consumer.shadowRoot!.innerHTML).toBe(`<div>changed!</div>`)
    })

    test('inherited from ancestors', async () => {
      const fooA = ref('FooA!')
      const fooB = ref('FooB!')
      const ProviderA = defineCustomElement({
        provide: {
          fooA
        },
        render() {
          return h('provider-b')
        }
      })
      const ProviderB = defineCustomElement({
        provide: {
          fooB
        },
        render() {
          return h('my-multi-consumer')
        }
      })

      const Consumer = defineCustomElement({
        setup() {
          const fooA = inject<Ref>('fooA')!
          const fooB = inject<Ref>('fooB')!
          return () => h('div', `${fooA.value} ${fooB.value}`)
        }
      })

      customElements.define('provider-a', ProviderA)
      customElements.define('provider-b', ProviderB)
      customElements.define('my-multi-consumer', Consumer)
      container.innerHTML = `<provider-a><provider-a>`
      const providerA = container.childNodes[0] as VueElement
      const providerB = providerA.shadowRoot!.childNodes[0] as VueElement
      const consumer = providerB.shadowRoot!.childNodes[0] as VueElement

      expect(consumer.shadowRoot!.innerHTML).toBe(`<div>FooA! FooB!</div>`)

      fooA.value = 'changedA!'
      fooB.value = 'changedB!'
      await nextTick()
      expect(consumer.shadowRoot!.innerHTML).toBe(
        `<div>changedA! changedB!</div>`
      )
    })
  })

  describe('styles', () => {
    test('should attach styles to shadow dom', () => {
      const Foo = defineCustomElement({
        styles: [`div { color: red; }`],
        render() {
          return h('div', 'hello')
        }
      })
      customElements.define('my-el-with-styles', Foo)
      container.innerHTML = `<my-el-with-styles></my-el-with-styles>`
      const el = container.childNodes[0] as VueElement
      const style = el.shadowRoot?.querySelector('style')!
      expect(style.textContent).toBe(`div { color: red; }`)
    })

    test('child components in shadow dom should have styles', async () => {
      const Child = {
        styles: [`.Child { color: blue; }`],
        render() {
          return h('div', { class: 'Child' }, 'hello')
        }
      }
      const Foo = defineCustomElement({
        components: { Child },
        styles: [`div { color: red; }`],
        render() {
          return h('div', {}, ['hello', h(Child)])
        }
      })
      customElements.define('my-el-with-child-styles', Foo)
      container.innerHTML = `<my-el-with-child-styles></my-el-with-child-styles>`
      await nextTick()

      const el = container.childNodes[0] as VueElement
      const style = el.shadowRoot?.querySelectorAll('style')!
      expect(style.length).toBe(2)
      expect(style[0].textContent).toBe(`.Child { color: blue; }`)
      expect(style[1].textContent).toBe(`div { color: red; }`)
    })
  })

  describe('async', () => {
    test('should work', async () => {
      const loaderSpy = vi.fn()
      const E = defineCustomElement(
        defineAsyncComponent(() => {
          loaderSpy()
          return Promise.resolve({
            props: ['msg'],
            styles: [`div { color: red }`],
            render(this: any) {
              return h('div', null, this.msg)
            }
          })
        })
      )
      customElements.define('my-el-async', E)
      container.innerHTML =
        `<my-el-async msg="hello"></my-el-async>` +
        `<my-el-async msg="world"></my-el-async>`

      await new Promise(r => setTimeout(r))

      // loader should be called only once
      expect(loaderSpy).toHaveBeenCalledTimes(1)

      const e1 = container.childNodes[0] as VueElement
      const e2 = container.childNodes[1] as VueElement

      // should inject styles
      expect(e1.shadowRoot!.innerHTML).toBe(
        `<style data-v-ce-root="">div { color: red }</style><div>hello</div>`
      )
      expect(e2.shadowRoot!.innerHTML).toBe(
        `<style data-v-ce-root="">div { color: red }</style><div>world</div>`
      )

      // attr
      e1.setAttribute('msg', 'attr')
      await nextTick()
      expect((e1 as any).msg).toBe('attr')
      expect(e1.shadowRoot!.innerHTML).toBe(
        `<style data-v-ce-root="">div { color: red }</style><div>attr</div>`
      )

      // props
      expect(`msg` in e1).toBe(true)
      ;(e1 as any).msg = 'prop'
      expect(e1.getAttribute('msg')).toBe('prop')
      expect(e1.shadowRoot!.innerHTML).toBe(
        `<style data-v-ce-root="">div { color: red }</style><div>prop</div>`
      )
    })

    test('child components in shadow dom should have styles & async', async () => {
      const Child = {
        styles: [`.Child { color: blue; }`],
        render() {
          return h('div', { class: 'Child' }, 'hello')
        }
      }
      const Foo = defineCustomElement(
        defineAsyncComponent(() => {
          return Promise.resolve({
            components: { Child },
            styles: [`div { color: red; }`],
            render() {
              return h('div', {}, ['hello', h(Child)])
            }
          })
        })
      )

      customElements.define('my-el-with-child-styles-async', Foo)
      container.innerHTML = `<my-el-with-child-styles-async></my-el-with-child-styles-async>`
      await new Promise(r => setTimeout(r))

      const el = container.childNodes[0] as VueElement
      const style = el.shadowRoot?.querySelectorAll('style')!
      expect(style.length).toBe(2)
      expect(style[0].textContent).toBe(`.Child { color: blue; }`)
      expect(style[1].textContent).toBe(`div { color: red; }`)
    })

    test('child components in shadow dom should have styles & async & descendants', async () => {
      const Child2 = defineAsyncComponent(() => {
        return Promise.resolve({
          styles: [`.Child2 { color: pink; }`],
          render() {
            return h('div', { class: 'Child2' }, 'pink')
          }
        } as ComponentOptions)
      })

      const Child = defineAsyncComponent(() => {
        return Promise.resolve({
          components: { Child2 },
          styles: [`.Child { color: blue; }`],
          render() {
            return h('div', { class: 'Child' }, ['hello', h(Child2)])
          }
        } as ComponentOptions)
      })
      const Parent = {
        components: { Child },
        styles: [`div { color: red; }`],
        render() {
          return h('div', {}, ['hello', h(Child)])
        }
      }
      const Foo = defineCustomElement(Parent)

      customElements.define('my-el-with-child-styles-async-descendants', Foo)
      container.innerHTML = `<my-el-with-child-styles-async-descendants></my-el-with-child-styles-async-descendants>`
      await new Promise(r => setTimeout(r))

      const el = container.childNodes[0] as VueElement
      const style = el.shadowRoot?.querySelectorAll('style')!
      expect(style.length).toBe(3)
      expect(style[0].textContent).toBe(`.Child2 { color: pink; }`)
      expect(style[1].textContent).toBe(`.Child { color: blue; }`)
      expect(style[2].textContent).toBe(`div { color: red; }`)
    })

    test('set DOM property before resolve', async () => {
      const E = defineCustomElement(
        defineAsyncComponent(() => {
          return Promise.resolve({
            props: ['msg'],
            setup(props) {
              expect(typeof props.msg).toBe('string')
            },
            render(this: any) {
              return h('div', this.msg)
            }
          })
        })
      )
      customElements.define('my-el-async-2', E)

      const e1 = new E()

      // set property before connect
      e1.msg = 'hello'

      const e2 = new E()

      container.appendChild(e1)
      container.appendChild(e2)

      // set property after connect but before resolve
      e2.msg = 'world'

      await new Promise(r => setTimeout(r))

      expect(e1.shadowRoot!.innerHTML).toBe(`<div>hello</div>`)
      expect(e2.shadowRoot!.innerHTML).toBe(`<div>world</div>`)

      e1.msg = 'world'
      expect(e1.shadowRoot!.innerHTML).toBe(`<div>world</div>`)

      e2.msg = 'hello'
      expect(e2.shadowRoot!.innerHTML).toBe(`<div>hello</div>`)
    })

    test('Number prop casting before resolve', async () => {
      const E = defineCustomElement(
        defineAsyncComponent(() => {
          return Promise.resolve({
            props: { n: Number },
            setup(props) {
              expect(props.n).toBe(20)
            },
            render(this: any) {
              return h('div', this.n + ',' + typeof this.n)
            }
          })
        })
      )
      customElements.define('my-el-async-3', E)
      container.innerHTML = `<my-el-async-3 n="2e1"></my-el-async-3>`

      await new Promise(r => setTimeout(r))

      const e = container.childNodes[0] as VueElement
      expect(e.shadowRoot!.innerHTML).toBe(`<div>20,number</div>`)
    })

    test('with slots', async () => {
      const E = defineCustomElement(
        defineAsyncComponent(() => {
          return Promise.resolve({
            render(this: any) {
              return [
                h('div', null, [
                  renderSlot(this.$slots, 'default', undefined, () => [
                    h('div', 'fallback')
                  ])
                ]),
                h('div', null, renderSlot(this.$slots, 'named'))
              ]
            }
          })
        })
      )
      customElements.define('my-el-async-slots', E)
      container.innerHTML = `<my-el-async-slots><span>hi</span></my-el-async-slots>`

      await new Promise(r => setTimeout(r))

      const e = container.childNodes[0] as VueElement
      expect(e.shadowRoot!.innerHTML).toBe(
        `<div><slot><div>fallback</div></slot></div><div><slot name="named"></slot></div>`
      )
    })
  })

  describe('child components styles', () => {
    test('Components are used multiple times without adding duplicate styles', async () => {
      const Child = {
        styles: [`.my-green { color: green; }`],
        render() {
          return h('p', { class: 'my-green' }, 'This should be green')
        }
      }

      const Foo = defineCustomElement({
        components: { Child },
        styles: [`.my-red { color: red; }`],
        render() {
          return [
            h('p', { class: 'my-red' }, 'This should be red'),
            h(Child),
            h(Child),
            h(Child)
          ]
        }
      })
      customElements.define('my-el-with-multiple-child', Foo)
      container.innerHTML = `<my-el-with-multiple-child></my-el-with-multiple-child><my-el-with-multiple-child></my-el-with-multiple-child>`
      await nextTick()

      const el1 = container.childNodes[0] as VueElement
      const style = el1.shadowRoot?.querySelectorAll('style')!
      expect(style.length).toBe(2)
      expect(style[0].textContent).toBe(`.my-green { color: green; }`)
      expect(style[1].textContent).toBe(`.my-red { color: red; }`)

      const el2 = container.childNodes[1] as VueElement
      const style2 = el2.shadowRoot?.querySelectorAll('style')!
      expect(style2.length).toBe(2)
      expect(style2[0].textContent).toBe(`.my-green { color: green; }`)
      expect(style2[1].textContent).toBe(`.my-red { color: red; }`)
    })

    test('nested child components w/ fragments in shadow dom should have styles', async () => {
      const GrandChild = {
        styles: [`.my-green { color: green; }`],
        render() {
          return h('p', { class: 'my-green' }, 'This should be green')
        }
      }
      const Child = {
        components: { GrandChild },
        styles: [`.my-blue { color: blue; }`],
        render() {
          return h('div', {}, [
            h('p', { class: 'my-blue' }, 'This should be blue'),
            h('div', {}, h(GrandChild))
          ])
        }
      }
      const Foo = defineCustomElement({
        components: { Child },
        styles: [`.my-red { color: red; }`],
        render() {
          return [h('p', { class: 'my-red' }, 'This should be red'), h(Child)]
        }
      })
      customElements.define('my-el-with-grandchild-styles', Foo)
      container.innerHTML = `<my-el-with-grandchild-styles></my-el-with-grandchild-styles>`
      await nextTick()

      const el = container.childNodes[0] as VueElement
      const style = el.shadowRoot?.querySelectorAll('style')!
      expect(style.length).toBe(3)
      expect(style[0].textContent).toBe(`.my-green { color: green; }`)
      expect(style[1].textContent).toBe(`.my-blue { color: blue; }`)
      expect(style[2].textContent).toBe(`.my-red { color: red; }`)
    })

    test('deeply nested child components w/ fragments in shadow dom should have styles', async () => {
      const GreatGrandChild = {
        styles: [`.my-grey { color: grey; }`],
        render() {
          return h('p', { class: 'my-grey' }, 'This should be grey')
        }
      }
      const GrandChild = {
        components: { GreatGrandChild },
        styles: [`.my-green { color: green; }`],
        render() {
          return [
            h('p', { class: 'my-green' }, 'This should be green'),
            h('span', {}, h(GreatGrandChild))
          ]
        }
      }
      const Child = {
        components: { GrandChild },
        styles: [`.my-blue { color: blue; }`],
        render() {
          return h('div', {}, [
            h('p', { class: 'my-blue' }, 'This should be blue'),
            h('div', {}, h(GrandChild))
          ])
        }
      }
      const Foo = defineCustomElement({
        components: { Child },
        styles: [`.my-red { color: red; }`],
        render() {
          return [h('p', { class: 'my-red' }, 'This should be red'), h(Child)]
        }
      })
      customElements.define('my-el-with-greatgrandchild-styles', Foo)
      container.innerHTML = `<my-el-with-greatgrandchild-styles></my-el-with-greatgrandchild-styles>`
      await nextTick()

      const el = container.childNodes[0] as VueElement
      const style = el.shadowRoot?.querySelectorAll('style')!
      expect(style.length).toBe(4)
      expect(style[0].textContent).toBe(`.my-grey { color: grey; }`)
      expect(style[1].textContent).toBe(`.my-green { color: green; }`)
      expect(style[2].textContent).toBe(`.my-blue { color: blue; }`)
      expect(style[3].textContent).toBe(`.my-red { color: red; }`)
    })
  })
})
