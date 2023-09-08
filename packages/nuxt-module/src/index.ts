/* eslint-disable @typescript-eslint/ban-ts-comment */
import { accessSync, constants, readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'
import type { Options } from '@plugin-web-update-notification/core'
import {
  DIRECTORY_NAME,
  INJECT_SCRIPT_FILE_NAME,
  INJECT_STYLE_FILE_NAME,
  JSON_FILE_NAME,
  NOTIFICATION_ANCHOR_CLASS_NAME,
  generateJSONFileContent,
  generateJsFileContent,
  getFileHash,
  getVersion,
  get__Dirname,
} from '@plugin-web-update-notification/core'
import type { Compilation, Compiler } from 'webpack'

const pluginName = 'WebUpdateNotificationPlugin'

type ModuleOptions = Options & {
  /** index.html file path, by default, we will look up path.resolve(webpackOutputPath, './index.html') */
  indexHtmlFilePath?: string,
  shouldBeEnable?: Function
}

/**
 * It injects the hash into the HTML, and injects the notification anchor and the stylesheet and the
 * script into the HTML
 * @param {string} html - The original HTML of the page
 * @param {string} version - The hash of the current commit
 * @param {Options} options - Options
 * @returns The html of the page with the injected script and css.
 */
function injectPluginHtml(
  html: string,
  version: string,
  options: Options,
  { cssFileHash, jsFileHash }: { jsFileHash: string; cssFileHash: string },
) {
  const { customNotificationHTML, hiddenDefaultNotification, injectFileBase = '/' } = options

  const versionScript = `<script>window.pluginWebUpdateNotice_version = '${version}';</script>`
  const cssLinkHtml = customNotificationHTML || hiddenDefaultNotification ? '' : `<link rel="stylesheet" href="${injectFileBase}${DIRECTORY_NAME}/${INJECT_STYLE_FILE_NAME}.${cssFileHash}.css">`
  let res = html

  res = res.replace(
    '<head>',
    `<head>
    ${cssLinkHtml}
    <script src="${injectFileBase}${DIRECTORY_NAME}/${INJECT_SCRIPT_FILE_NAME}.${jsFileHash}.js"></script>

    ${versionScript}`,
  )

  if (!hiddenDefaultNotification) {
    res = res.replace(
      '</body>',
      `<div class="${NOTIFICATION_ANCHOR_CLASS_NAME}"></div></body>`,
    )
  }

  return res
}

export default function WebUpdateNotificationPlugin(moduleOptions: ModuleOptions) {
  // this 为 modules 中的 context
  // 所有的 nuxt 的配置项
  // @ts-expect-error
  const options = this.options
  // 对当前 nuxt 实例的引用
  // @ts-expect-error
  const nuxt = this.nuxt

  /** inject script file hash */
  let jsFileHash = ''
  /** inject css file hash */
  let cssFileHash = ''
  // 版本信息
  let version = ''

  // 留一个函数 shouldBeEnable 可以判断是否开启
  if (typeof moduleOptions.shouldBeEnable === 'function') {
    const enable = moduleOptions.shouldBeEnable(options)
    if (!enable)
      return
  }

  // Emit assets： 注册 webpack 插件在构建期间发出资源
  options.build.plugins.push({
    apply(compiler: Compiler) {
      // 仅执行一次标识 （client 和 server 会分别走一次，不用再走服务端一次）
      if (compiler.options.name !== 'client')
        return

      const { publicPath } = compiler.options.output
      if (moduleOptions.injectFileBase === undefined) {
        moduleOptions.injectFileBase
          = typeof publicPath === 'string' ? publicPath : '/'
      }

      const { hiddenDefaultNotification, versionType, customVersion, silence }
        = moduleOptions
      if (versionType === 'custom')
        version = getVersion(versionType, customVersion || '')
      // @ts-expect-error
      else version = getVersion(versionType)

      compiler.hooks.emit.tap(pluginName, (compilation: Compilation) => {
        // const outputPath = compiler.outputPath
        const jsonFileContent = generateJSONFileContent(version, silence)
        // @ts-expect-error
        compilation.assets[`${DIRECTORY_NAME}/${JSON_FILE_NAME}.json`] = {
          source: () => jsonFileContent,
          size: () => jsonFileContent.length,
        }
        if (!hiddenDefaultNotification) {
          const injectStyleContent = readFileSync(
            `${get__Dirname()}/${INJECT_STYLE_FILE_NAME}.css`,
            'utf8',
          )
          cssFileHash = getFileHash(injectStyleContent)

          // @ts-expect-error
          compilation.assets[
            `${DIRECTORY_NAME}/${INJECT_STYLE_FILE_NAME}.${cssFileHash}.css`
          ] = {
            source: () => injectStyleContent,
            size: () => injectStyleContent.length,
          }
        }

        const filePath = resolve(
          `${get__Dirname()}/${INJECT_SCRIPT_FILE_NAME}.js`,
        )

        const injectScriptContent = generateJsFileContent(
          readFileSync(filePath, 'utf8').toString(),
          version,
          moduleOptions, // 传入 module 的参数控制
        )
        jsFileHash = getFileHash(injectScriptContent)

        // @ts-expect-error
        compilation.assets[
          `${DIRECTORY_NAME}/${INJECT_SCRIPT_FILE_NAME}.${jsFileHash}.js`
        ] = {
          source: () => injectScriptContent,
          size: () => injectScriptContent.length,
        }
      })
    },
  })

  // Hook on generation finished
  nuxt.hook('generate:done', async (generator: any) => {
    const htmlFilePath = resolve(
      generator.distPath,
      moduleOptions.indexHtmlFilePath || './index.html', // 可以自定义写入要 inject 的 html 地址
    )
    try {
      accessSync(htmlFilePath, constants.F_OK)

      let html = readFileSync(htmlFilePath, 'utf8')
      html = injectPluginHtml(html, version, moduleOptions, {
        jsFileHash,
        cssFileHash,
      })
      writeFileSync(htmlFilePath, html)
    }
    catch (error) {
      console.error(error)
      console.error(
        `${pluginName} failed to inject the plugin into the HTML file. index.html（${htmlFilePath}） not found.`,
      )
    }
  })
}
