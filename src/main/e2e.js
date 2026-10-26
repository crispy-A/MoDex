'use strict'

/**
 * 端到端验收脚本（仅 --e2e 模式加载，不参与正常启动）。
 * 在真实窗口中依次验证：初始化、文件树、打开文档、Markdown 预览、视图/主题切换、
 * 全局快捷键、查找栏、编辑保存、文件夹/文件新建、重命名、删除到回收站。
 * 结果写入 --e2e 指定的 JSON，截图写入 --screenshots 目录。
 */
const fs = require('node:fs')
const fsp = fs.promises
const path = require('node:path')
const { Menu } = require('electron')

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function runE2E({ win, cli, paths }) {
  const screenshotsDir = cli.screenshots ? path.resolve(cli.screenshots) : path.join(paths.artifacts, 'e2e')
  const reportPath = cli.e2e
  await fsp.mkdir(screenshotsDir, { recursive: true })

  const report = {
    startedAt: new Date().toISOString(),
    finishedAt: null,
    ok: false,
    rootDir: cli.root || null,
    openFile: cli.open || null,
    screenshots: [],
    assertions: [],
    steps: [],
    errors: [],
    disk: {},
  }

  const assert = (name, pass, detail) => {
    report.assertions.push({ name, pass: Boolean(pass), detail: detail === undefined ? null : detail })
    return Boolean(pass)
  }
  const step = (name, detail) => report.steps.push({ name, detail: detail === undefined ? null : detail })
  const fail = (name, error) => report.errors.push({ name, error: String((error && error.message) || error) })

  const run = async (label, script) => {
    try {
      return await win.webContents.executeJavaScript(`(async () => { ${script} })()`, true)
    } catch (err) {
      fail(label, err)
      return undefined
    }
  }

  /**
   * 截图：优先走 CDP Page.captureScreenshot（与合成器同源，能包含固定定位浮层，
   * 如右键菜单），失败时回退 electron capturePage。
   */
  const capturePng = async () => {
    try {
      if (!win.webContents.debugger.isAttached()) win.webContents.debugger.attach('1.3')
      const { data } = await win.webContents.debugger.sendCommand('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
      })
      if (data) return Buffer.from(data, 'base64')
    } catch (err) {
      report.errors.push({ name: 'cdp-screenshot', error: String((err && err.message) || err) })
    }
    try {
      return (await win.webContents.capturePage()).toPNG()
    } catch (err) {
      fail('capture-page', err)
      return null
    }
  }

  const shot = async (name, settle = 260) => {
    if (settle > 0) await delay(settle)
    try {
      let buffer = await capturePng()
      // 首帧可能在窗口尚未完成绘制时返回空图，延时重试一次
      if (!buffer || buffer.length < 1000) {
        await delay(700)
        buffer = await capturePng()
      }
      const file = path.join(screenshotsDir, `${name}.png`)
      await fsp.writeFile(file, buffer)
      report.screenshots.push(file)
      return file
    } catch (err) {
      fail(`screenshot:${name}`, err)
      return null
    }
  }

  const count = (script) => run(`count:${script.slice(0, 24)}`, `return ${script}`)

  /** 打开应用菜单（带重试：窗口失焦/截图时序可能让菜单自动关闭） */
  const openAppMenu = async (name) => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const state = await run(
        `open-app-menu-${name}-${attempt}`,
        `document.querySelector('[data-app-menu="${name}"]').click();
         await new Promise((resolve) => setTimeout(resolve, 280));
         const menu = document.getElementById('app-menu');
         return { visible: !!menu && !menu.hasAttribute('hidden') }`
      )
      if (state && state.visible) return true
      await run(
        'close-menus-retry',
        `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
         await new Promise((resolve) => setTimeout(resolve, 160));
         return true`
      )
      await delay(180)
    }
    return false
  }

  /** 在已打开的「视图」菜单中展开「预览样式」二级面板（带重试） */
  const openPreviewStyleSubmenu = async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const state = await run(
        `open-preview-style-submenu-${attempt}`,
        `const trigger = document.querySelector('#app-menu li[data-menu-key="preview-style"]');
         if (!trigger) return { visible: false, reason: 'no-trigger' };
         trigger.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
         (trigger.querySelector('button') || trigger).click();
         await new Promise((resolve) => setTimeout(resolve, 260));
         const submenu = document.getElementById('app-submenu');
         return { visible: !!submenu && !submenu.hasAttribute('hidden') }`
      )
      if (state && state.visible) return true
      await delay(150)
    }
    return false
  }

  try {
    // 0. 等待渲染层初始化
    const ready = await run(
      'wait-ready',
      `await Promise.race([window.__qm && window.__qm.ready, new Promise((_, reject) => setTimeout(() => reject(new Error('渲染层 15s 内未就绪')), 15000))]); return true`
    )
    assert('渲染层初始化完成（window.__qm.ready）', ready === true)
    step('等待渲染层就绪', { ready })

    // 注入全局错误收集器
    await run(
      'inject-error-collector',
      `window.__e2eErrors = [];
       window.addEventListener('error', (event) => { window.__e2eErrors.push('error: ' + (event.message || event.type)) });
       window.addEventListener('unhandledrejection', (event) => { window.__e2eErrors.push('rejection: ' + String((event.reason && event.reason.message) || event.reason)) });
       return true`
    )

    // 1. 基础外壳
    const shell = await run(
      'shell-check',
      `const ids = ['app','toolbar','sidebar','tree','editor','preview','statusbar','welcome','findbar','toasts'];
       return ids.filter((id) => !document.getElementById(id))`
    )
    assert('页面基础结构完整（10 个核心节点）', Array.isArray(shell) && shell.length === 0, shell)

    // 1.1 工具栏精简：只保留 5 个入口，5 个操作按钮已删除
    const toolbarCheck = await run(
      'toolbar-check',
      `const toolbar = document.getElementById('toolbar');
       const actions = [...toolbar.querySelectorAll('[data-action]')].map((node) => node.dataset.action).sort();
       const removed = ['new-doc', 'open-file', 'open-folder', 'save', 'save-as'].filter(
         (action) => toolbar.querySelector('[data-action="' + action + '"]')
       );
       return { actions, removed, height: Math.round(toolbar.getBoundingClientRect().height) }`
    )
    const expectedToolbarActions = ['theme-toggle', 'toggle-sidebar', 'view-edit', 'view-preview', 'view-split']
    assert(
      '工具栏只保留 5 个必要入口',
      toolbarCheck && JSON.stringify(toolbarCheck.actions) === JSON.stringify(expectedToolbarActions),
      toolbarCheck && toolbarCheck.actions
    )
    assert('工具栏 5 个操作按钮已删除', toolbarCheck && toolbarCheck.removed.length === 0, toolbarCheck && toolbarCheck.removed)
    assert('工具栏高度 40px', toolbarCheck && toolbarCheck.height === 40, toolbarCheck && toolbarCheck.height)

    // 1.2 单条导航栏：原生菜单栏隐藏，应用菜单仍注册（保留原生快捷键/role）
    assert('原生菜单栏已隐藏（单条导航栏）', win.isMenuBarVisible() === false, win.isMenuBarVisible())
    assert('应用菜单仍注册（保留原生快捷键）', Menu.getApplicationMenu() != null, Boolean(Menu.getApplicationMenu()))
    const appMenuButtons = await run(
      'app-menu-buttons',
      `return [...document.querySelectorAll('#toolbar [data-app-menu]')].map((node) => node.dataset.appMenu)`
    )
    assert(
      '工具栏包含 4 个应用菜单入口',
      JSON.stringify(appMenuButtons) === JSON.stringify(['file', 'edit', 'view', 'help']),
      appMenuButtons
    )

    // 关闭启动时自动打开的文档，回到欢迎页（同时验证 Ctrl+W）
    const closed = await run(
      'close-initial-doc',
      `const editor = document.getElementById('editor');
       editor.focus();
       editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', code: 'KeyW', ctrlKey: true, bubbles: true, cancelable: true }));
       await new Promise((resolve) => setTimeout(resolve, 350));
       const welcome = document.getElementById('welcome');
       return { visible: getComputedStyle(welcome).display !== 'none', state: window.__qm.getState() }`
    )
    assert('Ctrl+W 关闭文档并回到欢迎页', closed && closed.visible === true && closed.state.filePath === null, closed)
    await shot('01-welcome', 500)

    // 2. 打开文件夹（多根工作区的第一个根）
    const rootDir = cli.root
    if (rootDir) {
      await run('open-root', `await window.__qm.openRoot(${JSON.stringify(rootDir)}); return true`)
      await delay(400)
      const state = await run('state-after-root', 'return window.__qm.getState()')
      assert(
        '打开文件夹后根目录正确',
        state && Array.isArray(state.rootFolders) && state.rootFolders.includes(rootDir),
        state && state.rootFolders
      )
      const rootRows = await run(
        'root-rows',
        `return [...document.querySelectorAll('#tree li.tree-item[data-root="true"] .tree-label')].map((node) => node.textContent)`
      )
      assert('侧栏渲染文件夹根行', Array.isArray(rootRows) && rootRows.length === 1, rootRows)
      const treeRows = await count(`document.querySelectorAll('#tree li.tree-item').length`)
      assert('文件树渲染出节点', typeof treeRows === 'number' && treeRows > 0, treeRows)
      assert('文件树文件数量计入状态', state && state.treeFileCount > 0, state && state.treeFileCount)
      const welcomeRecent = await run('welcome-recent', `return document.querySelectorAll('#welcome [data-recent-path]').length`)
      assert('欢迎页展示最近打开记录', typeof welcomeRecent === 'number' && welcomeRecent >= 1, welcomeRecent)
      await shot('02-tree')

      // 2.1 文件树展开目录并通过点击打开嵌套文件
      const expandTest = await run(
        'tree-expand',
        `const items = [...document.querySelectorAll('#tree li.tree-item[data-type="dir"]')];
         const dirItem = items.find((li) => (li.querySelector('.tree-label') || {}).textContent === '子目录');
         if (!dirItem) return { found: false };
         (dirItem.querySelector('.tree-row') || dirItem).click();
         await new Promise((resolve) => setTimeout(resolve, 700));
         const expanded = [...document.querySelectorAll('#tree li.tree-item[data-type="dir"]')].find(
           (li) => (li.querySelector('.tree-label') || {}).textContent === '子目录'
         );
         const nested = [...document.querySelectorAll('#tree li.tree-item[data-type="file"]')].find(
           (li) => (li.querySelector('.tree-label') || {}).textContent === '笔记.md'
         );
         if (nested) (nested.querySelector('.tree-row') || nested).click();
         await new Promise((resolve) => setTimeout(resolve, 600));
         return {
           found: true,
           expanded: expanded ? expanded.dataset.expanded === 'true' : false,
           nestedVisible: Boolean(nested),
           openedPath: window.__qm.getState().filePath,
         }`
      )
      assert('文件树展开子目录', expandTest && expandTest.expanded === true, expandTest)
      assert('展开后显示嵌套文件', expandTest && expandTest.nestedVisible === true, expandTest)
      assert('点击文件树打开嵌套 Markdown', expandTest && /笔记\.md$/.test(expandTest.openedPath || ''), expandTest && expandTest.openedPath)
    } else {
      fail('open-root', new Error('缺少 --root 参数，无法验证文件树'))
    }

    // 3. 打开示例 Markdown 文档
    const sampleFile = cli.open
    if (sampleFile) {
      await run('open-file', `await window.__qm.openPath(${JSON.stringify(sampleFile)}); return true`)
      await delay(700)
      const state = await run('state-after-open', 'return window.__qm.getState()')
      assert('打开文档后文件名正确', state && state.fileName === path.basename(sampleFile), state && state.fileName)
      assert('文档内容已载入', state && typeof state.content === 'string' && state.content.includes('MoDex'), state && state.content.length)
      assert('默认分栏视图', state && state.viewMode === 'split', state && state.viewMode)
      assert('字数统计大于 0', state && state.wordCount > 0, state && state.wordCount)
      const docHead = await run(
        'doc-head',
        `return {
          title: (document.getElementById('doc-title') || {}).textContent || '',
          dir: (document.getElementById('doc-dir') || {}).textContent || '',
        }`
      )
      assert('标题栏显示文件名', docHead && docHead.title.includes('示例.md'), docHead)
      assert('标题栏显示所在目录', docHead && docHead.dir.includes('workspace'), docHead)

      const preview = await run(
        'preview-render',
        `return {
          h1: document.querySelectorAll('#preview h1').length,
          h2WithId: document.querySelectorAll('#preview h2[id]').length,
          table: document.querySelectorAll('#preview table').length,
          code: document.querySelectorAll('#preview pre code').length,
          checkbox: document.querySelectorAll('#preview input[type="checkbox"]').length,
          blockquote: document.querySelectorAll('#preview blockquote').length,
          externalLink: document.querySelectorAll('#preview a[href="https://example.com"]').length,
          image: document.querySelectorAll('#preview img').length,
          statusWords: (document.getElementById('status-words') || {}).textContent || '',
        }`
      )
      assert('预览渲染标题', preview && preview.h1 >= 1, preview && preview.h1)
      assert('预览标题生成锚点 id', preview && preview.h2WithId >= 1, preview && preview.h2WithId)
      assert('预览渲染表格', preview && preview.table >= 1, preview && preview.table)
      assert('预览渲染代码块', preview && preview.code >= 1, preview && preview.code)
      assert('预览渲染任务列表', preview && preview.checkbox >= 2, preview && preview.checkbox)
      assert('预览渲染引用块', preview && preview.blockquote >= 1, preview && preview.blockquote)
      assert('预览渲染外部链接', preview && preview.externalLink >= 1, preview && preview.externalLink)
      assert('状态栏显示字数', preview && /\d/.test(preview.statusWords), preview && preview.statusWords)

      // 本地图片通过 app://file 协议加载
      const imageLoaded = await run(
        'image-load',
        `const img = document.querySelector('#preview img');
         if (!img) return { found: false };
         const wait = new Promise((resolve) => {
           if (img.complete) return resolve(img.naturalWidth);
           img.addEventListener('load', () => resolve(img.naturalWidth), { once: true });
           img.addEventListener('error', () => resolve(0), { once: true });
           setTimeout(() => resolve(img.naturalWidth || 0), 3000);
         });
         const width = await wait;
         return { found: true, width, src: img.getAttribute('src') }`
      )
      assert('预览本地图片通过 app:// 协议加载成功', imageLoaded && imageLoaded.found && imageLoaded.width > 0, imageLoaded)

      await shot('03-split-light')

      // 3.1 单条导航栏：自绘应用菜单（文件/编辑/视图/帮助）
      const fileMenuOpened = await openAppMenu('file')
      const fileMenu = await run(
        'app-menu-file-read',
        `const menu = document.getElementById('app-menu');
         const text = menu ? menu.textContent : '';
         return {
           visible: !!menu && !menu.hasAttribute('hidden'),
           rows: menu ? menu.querySelectorAll('li').length : 0,
           hasNew: text.includes('新建文档'),
           hasSave: text.includes('保存'),
           hasSaveAs: text.includes('另存为'),
           hasQuit: text.includes('退出'),
           hasHints: text.includes('Ctrl+N') && text.includes('Ctrl+S'),
         }`
      )
      assert('文件菜单可打开', fileMenuOpened === true && fileMenu && fileMenu.visible === true, fileMenu)
      assert(
        '文件菜单包含完整操作项',
        fileMenu && fileMenu.hasNew && fileMenu.hasSave && fileMenu.hasSaveAs && fileMenu.hasQuit,
        fileMenu
      )
      assert('菜单项显示快捷键提示', fileMenu && fileMenu.hasHints === true, fileMenu)
      await shot('17-app-menu', 0)
      await run(
        'app-menu-esc',
        `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
         await new Promise((resolve) => setTimeout(resolve, 200));
         return true`
      )
      const menuClosed = await run('app-menu-closed', `return document.getElementById('app-menu').hasAttribute('hidden')`)
      assert('Esc 关闭应用菜单', menuClosed === true, menuClosed)

      // 视图菜单 → 编辑模式（验证下拉动作分发）
      const viewMenuOpened = await openAppMenu('view')
      const viewMenu = await run(
        'app-menu-view',
        `const menu = document.getElementById('app-menu');
         if (!menu || menu.hasAttribute('hidden')) return { opened: false };
         const rows = [...menu.querySelectorAll('li')];
         const target = rows.find((li) => (li.textContent || '').includes('编辑模式'));
         if (!target) return { opened: true, found: false };
         (target.querySelector('button') || target).click();
         await new Promise((resolve) => setTimeout(resolve, 350));
         return { opened: true, found: true, view: document.getElementById('app').dataset.view }`
      )
      assert(
        '视图菜单可切换到编辑模式',
        viewMenuOpened === true && viewMenu && viewMenu.opened && viewMenu.found && viewMenu.view === 'edit',
        viewMenu
      )
      await run('restore-split-view', `await window.__qm.setViewMode('split'); return true`)
      await delay(280)
      await shot('18-single-navbar')

      // 帮助菜单项存在（不点击，避免原生对话框阻塞）
      const helpMenuOpened = await openAppMenu('help')
      const helpMenu = await run(
        'app-menu-help-read',
        `const menu = document.getElementById('app-menu');
         const text = menu ? menu.textContent : '';
         const result = {
           visible: !!menu && !menu.hasAttribute('hidden'),
           shortcuts: text.includes('键盘快捷键'),
           about: text.includes('关于 MoDex'),
         };
         document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
         await new Promise((resolve) => setTimeout(resolve, 180));
         return result`
      )
      assert(
        '帮助菜单包含快捷键与关于',
        helpMenuOpened === true && helpMenu && helpMenu.visible && helpMenu.shortcuts && helpMenu.about,
        helpMenu
      )

      // 3.2 预览样式：7 套可选 + 持久化 + 深浅色生效
      const styleDefault = await run(
        'preview-style-default',
        `return {
          attr: document.getElementById('app').dataset.previewStyle || null,
          state: window.__qm.getState().previewStyle,
        }`
      )
      assert(
        '默认预览样式为 Codex 极简',
        styleDefault && styleDefault.attr === 'codex' && styleDefault.state === 'codex',
        styleDefault
      )

      const styleMenuOpened = await openAppMenu('view')
      const styleSubmenuOpened = await openPreviewStyleSubmenu()
      const styleMenu = await run(
        'preview-style-menu-read',
        `const submenu = document.getElementById('app-submenu');
         const options = submenu ? [...submenu.querySelectorAll('li[data-style-id]')] : [];
         return {
           found: options.length > 0,
           visible: !!submenu && !submenu.hasAttribute('hidden'),
           ids: options.map((li) => li.dataset.styleId),
           checked: options.filter((li) => li.dataset.checked === 'true').map((li) => li.dataset.styleId),
         }`
      )
      assert(
        '视图菜单包含「预览样式」二级菜单',
        styleMenuOpened === true && styleSubmenuOpened === true && styleMenu && styleMenu.found && styleMenu.visible,
        styleMenu
      )
      const expectedStyleIds = ['codex', 'github', 'vue', 'notion', 'feishu', 'tailwind', 'serif']
      assert(
        '预览样式包含 7 个选项',
        styleMenu && JSON.stringify(styleMenu.ids) === JSON.stringify(expectedStyleIds),
        styleMenu && styleMenu.ids
      )
      assert(
        '当前样式有选中标记',
        styleMenu && styleMenu.checked.length === 1 && styleMenu.checked[0] === 'codex',
        styleMenu && styleMenu.checked
      )
      // 菜单 + 二级面板视觉截图（先清空可能残留的 toast）
      await run('clean-toasts-for-menu-shot', `document.getElementById('toasts').replaceChildren(); return true`)
      await delay(150)
      await shot('21-preview-style-menu', 0)
      await run(
        'close-preview-style-menu',
        `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
         await new Promise((resolve) => setTimeout(resolve, 200));
         return true`
      )
      // 点击外部：一级菜单与二级面板必须同时关闭
      const reopenedForOutside = await openAppMenu('view')
      const submenuForOutside = await openPreviewStyleSubmenu()
      const outsideClose = await run(
        'preview-style-outside-close',
        `const editor = document.getElementById('editor');
         editor.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
         editor.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
         editor.click();
         await new Promise((resolve) => setTimeout(resolve, 260));
         return {
           menuHidden: document.getElementById('app-menu').hidden,
           submenuHidden: document.getElementById('app-submenu').hidden,
         }`
      )
      assert(
        '点击外部同时关闭预览样式二级面板与菜单',
        reopenedForOutside === true && submenuForOutside === true && outsideClose && outsideClose.menuHidden === true && outsideClose.submenuHidden === true,
        outsideClose
      )

      const styleOrder = ['github', 'vue', 'notion', 'feishu', 'tailwind', 'serif', 'codex']
      const styleResults = []
      for (const styleId of styleOrder) {
        const menuOpened = await openAppMenu('view')
        const submenuOpened = await openPreviewStyleSubmenu()
        const styleResult = await run(
          `preview-style-${styleId}`,
          `const option = document.querySelector('#app-submenu li[data-style-id="${styleId}"]');
           if (!option) return { applied: false, reason: 'no-option' };
           (option.querySelector('button') || option).click();
           await new Promise((resolve) => setTimeout(resolve, 420));
           const app = document.getElementById('app');
           const settings = await window.api.saveSettings({});
           return {
             applied: app.dataset.previewStyle === '${styleId}',
             attr: app.dataset.previewStyle,
             state: window.__qm.getState().previewStyle,
             saved: settings && settings.previewStyle,
             menusClosed:
               document.getElementById('app-menu').hasAttribute('hidden') &&
               document.getElementById('app-submenu').hasAttribute('hidden'),
           }`
        )
        styleResults.push({ styleId, result: styleResult })
        assert(
          `切换到「${styleId}」预览样式`,
          menuOpened === true && submenuOpened === true && styleResult && styleResult.applied === true,
          styleResult
        )
        assert(
          `「${styleId}」状态与持久化一致`,
          styleResult && styleResult.state === styleId && styleResult.saved === styleId,
          styleResult
        )
      }
      assert(
        '切换样式后两级菜单自动关闭',
        styleResults.every((item) => item.result && item.result.menusClosed === true),
        styleResults.map((item) => item.result && item.result.menusClosed)
      )

      // 样式签名检查：确认各套 CSS 真实生效（不是只改了属性）
      const styleSignature = async (styleId) => {
        await run(`signature-set-${styleId}`, `await window.__qm.setPreviewStyle('${styleId}'); return true`)
        await delay(150)
        return run(
          `signature-read-${styleId}`,
          `const h1 = document.querySelector('#preview h1');
           const pre = document.querySelector('#preview pre');
           const link = document.querySelector('#preview a');
           const h1Style = h1 ? getComputedStyle(h1) : null;
           const preStyle = pre ? getComputedStyle(pre) : null;
           const linkStyle = link ? getComputedStyle(link) : null;
           return {
             h1Border: h1Style ? h1Style.borderBottomWidth : null,
             h1Weight: h1Style ? h1Style.fontWeight : null,
             h1Font: h1Style ? h1Style.fontFamily : null,
             preBg: preStyle ? preStyle.backgroundColor : null,
             linkColor: linkStyle ? linkStyle.color : null,
           }`
        )
      }
      const githubSig = await styleSignature('github')
      assert(
        'GitHub 风：标题下划线 + 蓝色链接',
        githubSig && githubSig.h1Border !== '0px' && githubSig.linkColor === 'rgb(9, 105, 218)',
        githubSig
      )
      const vueSig = await styleSignature('vue')
      assert('Vue 风：深色代码块', vueSig && vueSig.preBg === 'rgb(40, 44, 52)', vueSig)
      const tailwindSig = await styleSignature('tailwind')
      assert('Tailwind 风：更重的标题字重', tailwindSig && Number(tailwindSig.h1Weight) >= 700, tailwindSig)
      const serifSig = await styleSignature('serif')
      assert('衬线风：衬线标题字体', serifSig && /Georgia|Songti|Noto Serif/i.test(serifSig.h1Font || ''), serifSig)
      await run('signature-reset-codex', `await window.__qm.setPreviewStyle('codex'); return true`)
      await delay(200)
      const codexSig = await run(
        'signature-codex',
        `const h1 = document.querySelector('#preview h1');
         return { h1Border: h1 ? getComputedStyle(h1).borderBottomWidth : null }`
      )
      assert('切回 Codex 后恢复默认标题样式', codexSig && codexSig.h1Border === '0px', codexSig)

      // 样式截图：浅色 GitHub 风、深色 Vue 风（截图前清空 toast，避免遮挡/串味）
      await run(
        'style-shot-github',
        `await window.__qm.setPreviewStyle('github');
         await window.__qm.setViewMode('preview');
         await new Promise((resolve) => setTimeout(resolve, 500));
         document.getElementById('toasts').replaceChildren();
         return true`
      )
      await delay(350)
      await shot('19-preview-style-github')
      await run(
        'style-shot-dark',
        `await window.__qm.setTheme('dark');
         await window.__qm.setPreviewStyle('vue');
         await new Promise((resolve) => setTimeout(resolve, 500));
         document.getElementById('toasts').replaceChildren();
         return true`
      )
      await delay(350)
      const darkAttr = await run(
        'style-shot-dark-check',
        `return {
          theme: document.getElementById('app').dataset.theme,
          style: document.getElementById('app').dataset.previewStyle,
        }`
      )
      assert('深色主题下可应用 Vue 预览样式', darkAttr && darkAttr.theme === 'dark' && darkAttr.style === 'vue', darkAttr)
      await shot('20-preview-style-dark')
      await run(
        'style-shot-reset',
        `await window.__qm.setTheme('light');
         await window.__qm.setPreviewStyle('codex');
         await window.__qm.setViewMode('split');
         return true`
      )
      await delay(350)

      // 4. 视图切换
      await run('view-preview', `await window.__qm.setViewMode('preview'); return true`)
      await delay(200)
      const previewMode = await run(
        'view-preview-check',
        `return {
          mode: document.getElementById('app').dataset.view,
          editorDisplay: getComputedStyle(document.getElementById('editor-pane')).display,
          previewDisplay: getComputedStyle(document.getElementById('preview-pane')).display,
        }`
      )
      assert('切换到预览模式', previewMode && previewMode.mode === 'preview', previewMode)
      assert('预览模式隐藏编辑器', previewMode && previewMode.editorDisplay === 'none', previewMode && previewMode.editorDisplay)
      assert('预览模式显示预览区', previewMode && previewMode.previewDisplay !== 'none', previewMode && previewMode.previewDisplay)
      await shot('04-preview-light')

      await run('view-edit', `await window.__qm.setViewMode('edit'); return true`)
      await delay(200)
      const editMode = await run(
        'view-edit-check',
        `return {
          mode: document.getElementById('app').dataset.view,
          editorDisplay: getComputedStyle(document.getElementById('editor-pane')).display,
          previewDisplay: getComputedStyle(document.getElementById('preview-pane')).display,
        }`
      )
      assert('切换到编辑模式', editMode && editMode.mode === 'edit', editMode)
      assert('编辑模式隐藏预览区', editMode && editMode.previewDisplay === 'none', editMode && editMode.previewDisplay)
      assert('编辑模式显示编辑器', editMode && editMode.editorDisplay !== 'none', editMode && editMode.editorDisplay)
      await shot('05-edit-light')

      // 5. 深色主题 + 全局快捷键
      await run('theme-dark', `await window.__qm.setTheme('dark'); await window.__qm.setViewMode('split'); return true`)
      await delay(300)
      const darkMode = await run(
        'theme-dark-check',
        `const app = document.getElementById('app');
         return { theme: app.dataset.theme, bg: getComputedStyle(document.getElementById('sidebar')).backgroundColor }`
      )
      assert('切换到深色主题', darkMode && darkMode.theme === 'dark', darkMode)
      await shot('06-split-dark')

      const keyTest = await run(
        'keyboard-shortcuts',
        `const editor = document.getElementById('editor');
         const fire = (init) => { editor.focus(); (document.activeElement || editor).dispatchEvent(new KeyboardEvent('keydown', Object.assign({ bubbles: true, cancelable: true }, init))) };
         const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
         const view = () => document.getElementById('app').dataset.view;
         const theme = () => document.getElementById('app').dataset.theme;
         const results = {};
         fire({ key: '3', code: 'Digit3', ctrlKey: true }); await wait(180); results.afterCtrl3 = view();
         fire({ key: '1', code: 'Digit1', ctrlKey: true }); await wait(180); results.afterCtrl1 = view();
         fire({ key: '2', code: 'Digit2', ctrlKey: true }); await wait(180); results.afterCtrl2 = view();
         // 侧栏显示 / 隐藏
         fire({ key: 'E', code: 'KeyE', ctrlKey: true, shiftKey: true }); await wait(220);
         results.sidebarHidden = getComputedStyle(document.getElementById('sidebar')).display === 'none' || document.getElementById('app').dataset.sidebar === 'hidden';
         fire({ key: 'E', code: 'KeyE', ctrlKey: true, shiftKey: true }); await wait(220);
         results.sidebarRestored = getComputedStyle(document.getElementById('sidebar')).display !== 'none';
         // 主题切换
         const themeBefore = theme();
         fire({ key: 'T', code: 'KeyT', ctrlKey: true, shiftKey: true }); await wait(300);
         results.themeToggled = theme() !== themeBefore;
         results.themeAfterToggle = theme();
         // 字号缩放与重置
         const sizeBefore = parseFloat(getComputedStyle(editor).fontSize);
         fire({ key: '=', code: 'Equal', ctrlKey: true }); await wait(260);
         results.zoomIn = parseFloat(getComputedStyle(editor).fontSize) > sizeBefore;
         fire({ key: '0', code: 'Digit0', ctrlKey: true }); await wait(260);
         results.zoomReset = Math.abs(parseFloat(getComputedStyle(editor).fontSize) - sizeBefore) < 0.6;
         return results`
      )
      assert('Ctrl+3 切换到预览模式', keyTest && keyTest.afterCtrl3 === 'preview', keyTest && keyTest.afterCtrl3)
      assert('Ctrl+1 切换到编辑模式', keyTest && keyTest.afterCtrl1 === 'edit', keyTest && keyTest.afterCtrl1)
      assert('Ctrl+2 切换到分栏模式', keyTest && keyTest.afterCtrl2 === 'split', keyTest && keyTest.afterCtrl2)
      assert('Ctrl+Shift+E 隐藏侧栏', keyTest && keyTest.sidebarHidden === true, keyTest && keyTest.sidebarHidden)
      assert('Ctrl+Shift+E 恢复侧栏', keyTest && keyTest.sidebarRestored === true, keyTest && keyTest.sidebarRestored)
      assert('Ctrl+Shift+T 切换主题', keyTest && keyTest.themeToggled === true, keyTest && keyTest.themeAfterToggle)
      assert('Ctrl+= 放大字号', keyTest && keyTest.zoomIn === true, keyTest && keyTest.zoomIn)
      assert('Ctrl+0 重置字号', keyTest && keyTest.zoomReset === true, keyTest && keyTest.zoomReset)

      await run('theme-light', `await window.__qm.setTheme('light'); return true`)

      // 6. 查找栏
      const findTest = await run(
        'find-bar',
        `const editor = document.getElementById('editor');
         const fire = (init) => { editor.focus(); (document.activeElement || editor).dispatchEvent(new KeyboardEvent('keydown', Object.assign({ bubbles: true, cancelable: true }, init))) };
         fire({ key: 'f', code: 'KeyF', ctrlKey: true });
         await new Promise((resolve) => setTimeout(resolve, 250));
         const bar = document.getElementById('findbar');
         const visible = !bar.hasAttribute('hidden');
         const input = document.getElementById('find-input');
         input.value = 'Markdown';
         input.dispatchEvent(new Event('input', { bubbles: true }));
         await new Promise((resolve) => setTimeout(resolve, 300));
         const countText = (document.getElementById('find-count') || {}).textContent || '';
         input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
         await new Promise((resolve) => setTimeout(resolve, 200));
         const hiddenAfterEsc = bar.hasAttribute('hidden');
         return { visible, countText, hiddenAfterEsc }`
      )
      assert('Ctrl+F 打开查找栏', findTest && findTest.visible === true, findTest)
      assert('查找栏显示匹配计数', findTest && /\d/.test(findTest.countText) && findTest.countText.includes('/'), findTest && findTest.countText)
      assert('Esc 关闭查找栏', findTest && findTest.hiddenAfterEsc === true, findTest && findTest.hiddenAfterEsc)

      // 6.1 查找栏浮层视觉截图
      const findShot = await run(
        'find-open-for-shot',
        `const editor = document.getElementById('editor');
         editor.focus();
         editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', code: 'KeyF', ctrlKey: true, bubbles: true, cancelable: true }));
         await new Promise((resolve) => setTimeout(resolve, 240));
         const input = document.getElementById('find-input');
         input.value = 'Markdown';
         input.dispatchEvent(new Event('input', { bubbles: true }));
         await new Promise((resolve) => setTimeout(resolve, 340));
         return !document.getElementById('findbar').hasAttribute('hidden')`
      )
      assert('查找栏可再次打开（截图）', findShot === true, findShot)
      await shot('12-findbar')
      await run(
        'close-find-for-shot',
        `const input = document.getElementById('find-input');
         input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
         await new Promise((resolve) => setTimeout(resolve, 200));
         return true`
      )

      // 7. 编辑并保存到磁盘
      const marker = `E2E_MARKER_${Date.now()}`
      const dirty = await run(
        'edit-content',
        `const editor = document.getElementById('editor');
         editor.focus();
         editor.value = editor.value + ${JSON.stringify('\n\n## e2e 追加段落\n\n' + marker + '\n')};
         editor.dispatchEvent(new Event('input', { bubbles: true }));
         await new Promise((r) => setTimeout(r, 350));
         return window.__qm.getState().dirty`
      )
      assert('编辑后标记为未保存', dirty === true, dirty)
      await shot('13-dirty')

      // 保存改用快捷键 Ctrl+S（工具栏保存按钮已删除，验证快捷键通路）
      const savedByKey = await run(
        'save-via-ctrl-s',
        `const editor = document.getElementById('editor');
         editor.focus();
         editor.dispatchEvent(new KeyboardEvent('keydown', { key: 's', code: 'KeyS', ctrlKey: true, bubbles: true, cancelable: true }));
         await new Promise((resolve) => setTimeout(resolve, 1000));
         return { dirty: window.__qm.getState().dirty }`
      )
      assert('Ctrl+S 快捷键保存成功', savedByKey && savedByKey.dirty === false, savedByKey)
      await delay(200)
      const saveState = await run('save-check', 'return window.__qm.getState()')
      assert('保存后未保存标记清除', saveState && saveState.dirty === false, saveState && saveState.dirty)
      try {
        const diskContent = await fsp.readFile(sampleFile, 'utf8')
        const saved = diskContent.includes(marker)
        report.disk.savedMarker = saved
        assert('保存内容已写入磁盘', saved, { length: diskContent.length })
      } catch (err) {
        fail('read-saved-file', err)
        assert('保存内容已写入磁盘', false, String(err.message))
      }
      await shot('07-after-save')

      // 7.1 自动保存：切换文件时落盘
      const switchMarker = `AUTO_SAVE_SWITCH_${Date.now()}`
      const otherFile = path.join(path.dirname(sampleFile), '欢迎.md')
      const switchResult = await run(
        'autosave-on-switch',
        `const editor = document.getElementById('editor');
         editor.focus();
         editor.value = editor.value + ${JSON.stringify(`\n\n${switchMarker}\n`)};
         editor.dispatchEvent(new Event('input', { bubbles: true }));
         await new Promise((resolve) => setTimeout(resolve, 420));
         const dirtyBefore = window.__qm.getState().dirty;
         await window.__qm.openPath(${JSON.stringify(otherFile)});
         await new Promise((resolve) => setTimeout(resolve, 900));
         const state = window.__qm.getState();
         return { dirtyBefore, filePath: state.filePath, dirty: state.dirty }`
      )
      assert('切换文件前文档为未保存', switchResult && switchResult.dirtyBefore === true, switchResult)
      assert(
        '切换文件后打开目标文件',
        switchResult && /欢迎\.md$/.test(switchResult.filePath || '') && switchResult.dirty === false,
        switchResult
      )
      try {
        const sampleDisk = await fsp.readFile(sampleFile, 'utf8')
        const savedOnSwitch = sampleDisk.includes(switchMarker)
        report.disk.autosaveOnSwitch = savedOnSwitch
        assert('切换文件时自动保存原文档', savedOnSwitch, { length: sampleDisk.length })
      } catch (err) {
        fail('read-autosave-switch', err)
        assert('切换文件时自动保存原文档', false, String(err.message))
      }

      // 7.2 自动保存：关闭文档（Ctrl+W）时落盘
      const closeMarker = `AUTO_SAVE_CLOSE_${Date.now()}`
      const closeResult = await run(
        'autosave-on-close-doc',
        `const editor = document.getElementById('editor');
         editor.focus();
         editor.value = editor.value + ${JSON.stringify(`\n\n${closeMarker}\n`)};
         editor.dispatchEvent(new Event('input', { bubbles: true }));
         await new Promise((resolve) => setTimeout(resolve, 420));
         editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', code: 'KeyW', ctrlKey: true, bubbles: true, cancelable: true }));
         await new Promise((resolve) => setTimeout(resolve, 1000));
         const state = window.__qm.getState();
         return {
           filePath: state.filePath,
           dirty: state.dirty,
           welcomeVisible: getComputedStyle(document.getElementById('welcome')).display !== 'none',
         }`
      )
      assert(
        'Ctrl+W 关闭文档后回到欢迎页',
        closeResult && closeResult.filePath === null && closeResult.welcomeVisible === true,
        closeResult
      )
      try {
        const otherDisk = await fsp.readFile(otherFile, 'utf8')
        const savedOnCloseDoc = otherDisk.includes(closeMarker)
        report.disk.autosaveOnCloseDoc = savedOnCloseDoc
        assert('关闭文档时自动保存', savedOnCloseDoc, { length: otherDisk.length })
      } catch (err) {
        fail('read-autosave-close-doc', err)
        assert('关闭文档时自动保存', false, String(err.message))
      }

      // 重新打开示例文档，继续后续步骤
      await run('reopen-sample-after-autosave', `await window.__qm.openPath(${JSON.stringify(sampleFile)}); return true`)
      await delay(600)

      // 8. 右键菜单
      const contextTest = await run(
        'context-menu',
        `const item = document.querySelector('#tree li.tree-item[data-type="file"]');
         const row = item && item.querySelector('.tree-row');
         if (!row) return { opened: false, reason: 'no-file-row' };
         const rect = row.getBoundingClientRect();
         row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: rect.left + 40, clientY: rect.top + 10 }));
         await new Promise((r) => setTimeout(r, 250));
         const menu = document.getElementById('context-menu');
         return { opened: !!menu && !menu.hasAttribute('hidden'), items: menu ? menu.querySelectorAll('li[data-menu-action]').length : 0 }`
      )
      assert('文件树右键菜单可打开', contextTest && contextTest.opened === true, contextTest)
      assert('右键菜单包含操作项', contextTest && contextTest.items >= 3, contextTest && contextTest.items)
      await shot('08-context-menu', 0)
      const menuDiag = await run(
        'menu-diag',
        `const menu = document.getElementById('context-menu');
         const rect = menu.getBoundingClientRect();
         const style = getComputedStyle(menu);
         const cx = Math.min(Math.max(rect.left + rect.width / 2, 1), window.innerWidth - 1);
         const cy = Math.min(Math.max(rect.top + rect.height / 2, 1), window.innerHeight - 1);
         const top = document.elementFromPoint(cx, cy);
         return {
           rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
           display: style.display,
           visibility: style.visibility,
           opacity: style.opacity,
           zIndex: style.zIndex,
           position: style.position,
           hiddenAttr: menu.hasAttribute('hidden'),
           children: menu.children.length,
           topElement: top ? (top.id || top.className || top.tagName) : null,
         }`
      )
      step('右键菜单 DOM 诊断', menuDiag)
      let menuStillOpen = await run(
        'context-menu-after-shot',
        `const menu = document.getElementById('context-menu');
         return { open: !!menu && !menu.hasAttribute('hidden') }`
      )
      if (!menuStillOpen || menuStillOpen.open !== true) {
        // 偶发：窗口失焦/截图时序导致菜单被关闭；重新打开并重试一次截图
        await run(
          'reopen-context-menu',
          `const item = document.querySelector('#tree li.tree-item[data-type="file"]');
           const row = item && item.querySelector('.tree-row');
           if (!row) return false;
           const rect = row.getBoundingClientRect();
           row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: rect.left + 40, clientY: rect.top + 10 }));
           await new Promise((resolve) => setTimeout(resolve, 280));
           return true`
        )
        await shot('08-context-menu', 0)
        menuStillOpen = await run(
          'context-menu-after-retry',
          `const menu = document.getElementById('context-menu');
           return { open: !!menu && !menu.hasAttribute('hidden') }`
        )
      }
      assert('右键菜单截图时仍打开', menuStillOpen && menuStillOpen.open === true, menuStillOpen)
      await run('close-context', `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })); await new Promise((resolve) => setTimeout(resolve, 150)); return true`)

      // 8.1 根行右键菜单 →「新建文件」行内创建（替代已删除的侧栏新建按钮）
      // 先让此前自动保存产生的 fs.watch 刷新落地，避免与行内输入状态竞争
      await delay(900)
      const uiCreate = await run(
        'ui-create-file',
        `const rootItem = document.querySelector('#tree li.tree-item[data-root="true"]');
         const rootRow = rootItem && rootItem.querySelector('.tree-row');
         if (!rootRow) return { found: false, reason: 'no-root-row' };
         const rect = rootRow.getBoundingClientRect();
         rootRow.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: rect.left + 60, clientY: rect.top + 12 }));
         await new Promise((resolve) => setTimeout(resolve, 300));
         const menu = document.getElementById('context-menu');
         const menuActions = menu ? [...menu.querySelectorAll('li[data-menu-action]')].map((li) => li.dataset.menuAction) : [];
         const newFileButton = menu ? menu.querySelector('li[data-menu-action="tree:new-file"] button') : null;
         if (!newFileButton) return { found: false, menuActions, reason: 'no-menu-item' };
         newFileButton.click();
         // 轮询等待行内输入框（后台刷新可能稍晚），最多 3s
         let input = null;
         for (let i = 0; i < 20 && !input; i += 1) {
           await new Promise((resolve) => setTimeout(resolve, 150));
           input = document.querySelector('#tree .tree-input');
         }
         if (!input) return { found: false, menuActions, reason: 'no-inline-input' };
         input.value = 'e2e-ui-新建.md';
         input.dispatchEvent(new Event('input', { bubbles: true }));
         input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
         await new Promise((resolve) => setTimeout(resolve, 1100));
         const state = window.__qm.getState();
         const labels = [...document.querySelectorAll('#tree li.tree-item[data-type="file"] .tree-label')].map(
           (node) => node.textContent
         );
         return { found: true, created: labels.includes('e2e-ui-新建.md'), openedPath: state.filePath, labels, menuActions }`
      )
      assert(
        '根行右键菜单包含新建文件 / 移除文件夹',
        uiCreate && Array.isArray(uiCreate.menuActions) && uiCreate.menuActions.includes('tree:new-file') && uiCreate.menuActions.includes('tree:remove-root'),
        uiCreate && uiCreate.menuActions
      )
      assert('根行菜单 UI 新建 Markdown 文件（行内输入）', uiCreate && uiCreate.created === true, uiCreate)
      assert('UI 新建后自动打开新文件', uiCreate && /e2e-ui-新建\.md$/.test(uiCreate.openedPath || ''), uiCreate && uiCreate.openedPath)
      const uiCreatedPath = path.join(rootDir, 'e2e-ui-新建.md')
      assert('UI 新建文件落地磁盘', fs.existsSync(uiCreatedPath), uiCreatedPath)
      await run('cleanup-ui-file', `return await window.api.remove(${JSON.stringify(uiCreatedPath)})`)
    } else {
      fail('open-file', new Error('缺少 --open 参数，无法验证文档打开'))
    }

    // 9. 文件/文件夹创建、重命名、删除
    if (rootDir) {
      const folderCreated = await run('create-folder', `return await window.api.createFolder(${JSON.stringify(rootDir)}, 'e2e-目录')`)
      assert('新建文件夹成功', folderCreated && folderCreated.ok === true, folderCreated)
      const fileCreated = await run('create-file', `return await window.api.createFile(${JSON.stringify(rootDir)}, 'e2e-新建.md', '# e2e 新建文件\\n')`)
      assert('新建 Markdown 文件成功', fileCreated && fileCreated.ok === true, fileCreated)
      assert('新建文件落地磁盘', fileCreated && fileCreated.ok && fs.existsSync(fileCreated.path), fileCreated && fileCreated.path)

      // 通过侧栏「刷新」按钮刷新文件树（保留展开状态）
      const refreshed = await run(
        'refresh-tree-button',
        `document.querySelector('[data-action="refresh-tree"]').click();
         await new Promise((resolve) => setTimeout(resolve, 700));
         const labels = [...document.querySelectorAll('#tree li.tree-item .tree-label')].map(
           (node) => node.textContent
         );
         return { labels }`
      )
      const labels = (refreshed && refreshed.labels) || []
      assert('刷新按钮后文件树出现新建文件夹', labels.includes('e2e-目录'), labels)
      assert('刷新按钮后文件树出现新建文件', labels.includes('e2e-新建.md'), labels)

      const renamed = await run('rename-file', `return await window.api.rename(${JSON.stringify(fileCreated && fileCreated.path)}, 'e2e-重命名.md')`)
      assert('重命名文件成功', renamed && renamed.ok === true, renamed)
      const renamedInfo = await run('renamed-info', `return await window.api.pathInfo(${JSON.stringify(renamed && renamed.path)})`)
      assert('重命名后新路径存在', renamedInfo && renamedInfo.ok && renamedInfo.exists === true, renamedInfo)

      const deletedFile = await run('delete-file', `return await window.api.remove(${JSON.stringify(renamed && renamed.path)})`)
      assert('删除 Markdown 文件成功（回收站）', deletedFile && deletedFile.ok === true, deletedFile)
      const deletedInfo = await run('deleted-info', `return await window.api.pathInfo(${JSON.stringify(renamed && renamed.path)})`)
      assert('删除后文件已不存在', deletedInfo && deletedInfo.ok && deletedInfo.exists === false, deletedInfo)

      const deleteFolder = await run('delete-folder', `return await window.api.remove(${JSON.stringify(folderCreated && folderCreated.path)})`)
      assert('删除空文件夹成功', deleteFolder && deleteFolder.ok === true, deleteFolder)
      report.disk.trashed = Boolean(deletedFile && deletedFile.trashed)

      const refreshedAfterDelete = await run(
        'refresh-tree-after-delete',
        `document.querySelector('[data-action="refresh-tree"]').click();
         await new Promise((resolve) => setTimeout(resolve, 700));
         const labels = [...document.querySelectorAll('#tree li.tree-item .tree-label')].map(
           (node) => node.textContent
         );
         return { labels }`
      )
      const labelsAfter = (refreshedAfterDelete && refreshedAfterDelete.labels) || []
      assert('删除后文件树不再显示已删节点', !labelsAfter.includes('e2e-重命名.md') && !labelsAfter.includes('e2e-目录'), labelsAfter)
      await shot('09-tree-after-ops')

      // 重新打开示例文档，供最终截图
      if (sampleFile) {
        await run('reopen-sample', `await window.__qm.openPath(${JSON.stringify(sampleFile)}); return true`)
        await delay(500)
      }
    }

    // 9.5 多文件夹工作区（多根：Codex 项目列表式）
    if (rootDir) {
      const secondRoot = path.join(path.dirname(rootDir), '第二工作区')
      const secondRootName = path.basename(secondRoot)
      if (!fs.existsSync(secondRoot)) {
        fail('second-root', new Error(`缺少第二工作区：${secondRoot}`))
      } else {
        await run('add-second-root', `await window.__qm.openRoot(${JSON.stringify(secondRoot)}); return true`)
        await delay(900)
        const multi = await run(
          'multi-root-state',
          `return {
            state: window.__qm.getState(),
            rootCount: document.querySelectorAll('#tree li.tree-item[data-root="true"]').length,
            rootLabels: [...document.querySelectorAll('#tree li.tree-item[data-root="true"] .tree-label')].map((node) => node.textContent),
          }`
        )
        assert(
          '支持同时打开多个文件夹',
          multi && multi.state.rootFolders.length === 2 && multi.rootCount === 2,
          multi && { roots: multi.state.rootFolders, rootCount: multi.rootCount }
        )
        assert('侧栏显示两个文件夹根', multi && multi.rootLabels.includes(secondRootName), multi && multi.rootLabels)
        await shot('14-multi-root')

        // 根行右键菜单（Codex 风格更多操作）
        const rootMenu = await run(
          'root-context-menu',
          `const items = [...document.querySelectorAll('#tree li.tree-item[data-root="true"]')];
           const target = items.find((li) => (li.querySelector('.tree-label') || {}).textContent === ${JSON.stringify(secondRootName)});
           if (!target) return { opened: false, actions: [] };
           const row = target.querySelector('.tree-row');
           const rect = row.getBoundingClientRect();
           row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: rect.left + 40, clientY: rect.top + 10 }));
           await new Promise((resolve) => setTimeout(resolve, 260));
           const menu = document.getElementById('context-menu');
           return {
             opened: !!menu && !menu.hasAttribute('hidden'),
             actions: menu ? [...menu.querySelectorAll('li[data-menu-action]')].map((li) => li.dataset.menuAction) : [],
           }`
        )
        assert('根行右键菜单可打开', rootMenu && rootMenu.opened === true, rootMenu)
        assert(
          '根菜单包含新建与从列表移除',
          rootMenu && rootMenu.actions.includes('tree:new-file') && rootMenu.actions.includes('tree:remove-root'),
          rootMenu && rootMenu.actions
        )
        await shot('15-root-menu', 0)
        await run(
          'close-root-menu',
          `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
           await new Promise((resolve) => setTimeout(resolve, 150));
           return true`
        )

        // 点击第二个根中的文件打开
        const secondOpen = await run(
          'open-second-root-file',
          `const rows = [...document.querySelectorAll('#tree li.tree-item[data-type="file"]')];
           const target = rows.find((li) => (li.querySelector('.tree-label') || {}).textContent === '第二笔记.md');
           if (!target) return { found: false };
           target.querySelector('.tree-row').click();
           await new Promise((resolve) => setTimeout(resolve, 800));
           return {
             found: true,
             filePath: window.__qm.getState().filePath,
             activeFolder: window.__qm.getState().activeFolder,
           }`
        )
        assert('可打开第二个文件夹中的文件', secondOpen && /第二笔记\.md$/.test(secondOpen.filePath || ''), secondOpen)
        assert(
          '打开后激活对应文件夹根',
          secondOpen && secondOpen.activeFolder === secondRoot,
          secondOpen && secondOpen.activeFolder
        )

        // 第二个根的外部变更由 fs.watch 自动刷新（不点刷新按钮）
        const secondCreate = await run(
          'create-in-second-root',
          `return await window.api.createFile(${JSON.stringify(secondRoot)}, 'e2e-第二根-新建.md', '# 第二根\\n')`
        )
        assert('第二根新建文件成功', secondCreate && secondCreate.ok === true, secondCreate)
        await delay(1800)
        const watcherCheck = await run(
          'watcher-second-root',
          `return [...document.querySelectorAll('#tree li.tree-item .tree-label')]
             .map((node) => node.textContent)
             .includes('e2e-第二根-新建.md')`
        )
        assert('第二文件夹变更自动刷新文件树', watcherCheck === true, watcherCheck)

        // 移除根（不删除磁盘目录）
        const removeSecondRoot = await run(
          'remove-second-root',
          `await window.__qm.removeRoot(${JSON.stringify(secondRoot)});
           await new Promise((resolve) => setTimeout(resolve, 700));
           return {
             roots: window.__qm.getState().rootFolders,
             activeFolder: window.__qm.getState().activeFolder,
             rootCount: document.querySelectorAll('#tree li.tree-item[data-root="true"]').length,
           }`
        )
        assert(
          '可移除文件夹根且侧栏同步',
          removeSecondRoot && removeSecondRoot.roots.length === 1 && removeSecondRoot.rootCount === 1,
          removeSecondRoot
        )
        assert('移除根不删除磁盘目录', fs.existsSync(secondRoot), secondRoot)
        await shot('16-single-root-again')
        await run('cleanup-second-file', `return await window.api.remove(${JSON.stringify(secondCreate && secondCreate.path)})`)
        if (sampleFile) {
          await run('reopen-sample-2', `await window.__qm.openPath(${JSON.stringify(sampleFile)}); return true`)
          await delay(500)
        }
      }
    }

    // 10. 未捕获错误
    const jsErrors = await run('collect-errors', 'return window.__e2eErrors || []')
    assert('运行期无未捕获 JS 错误', Array.isArray(jsErrors) && jsErrors.length === 0, jsErrors)

    // 11. 收尾截图
    await run('final-light', `await window.__qm.setTheme('light'); await window.__qm.setViewMode('split'); return true`)
    await shot('10-final-light')

    // 12. 最小窗口尺寸下的布局（900×600，不应出现横向滚动条）
    try {
      const originalBounds = win.getContentBounds()
      win.setContentSize(900, 600)
      await delay(500)
      const layout = await run(
        'min-window-layout',
        `return {
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
          scrollWidth: document.documentElement.scrollWidth,
          scrollHeight: document.documentElement.scrollHeight,
          overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
        }`
      )
      assert('最小窗口 900×600 无横向溢出', layout && layout.overflowX === false, layout)
      await shot('11-min-window')
      win.setContentBounds(originalBounds)
      await delay(300)
    } catch (err) {
      fail('min-window-layout', err)
    }

    // 13. 设置持久化（写入 -> 读回 -> 复原）
    const settings = await run(
      'settings-roundtrip',
      `const saved = await window.api.saveSettings({ theme: 'dark' });
       const readback = await window.api.saveSettings({});
       await window.api.saveSettings({ theme: 'system', viewMode: 'split' });
       return { saved: saved && saved.theme, readback: readback && readback.theme }`
    )
    assert('设置持久化接口正常', settings && settings.saved === 'dark' && settings.readback === 'dark', settings)
  } catch (err) {
    fail('unexpected', err)
  }

  report.ok = report.assertions.length > 0 && report.assertions.every((item) => item.pass) && report.errors.length === 0
  report.finishedAt = new Date().toISOString()
  const summary = {
    ok: report.ok,
    assertions: `${report.assertions.filter((item) => item.pass).length}/${report.assertions.length}`,
    errors: report.errors,
    screenshots: report.screenshots,
  }
  try {
    await fsp.mkdir(path.dirname(reportPath), { recursive: true })
    await fsp.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8')
  } catch (err) {
    console.error('[e2e] 写入报告失败：', err)
  }
  console.log('[e2e] RESULT ' + JSON.stringify(summary))
  return report
}

/**
 * 关闭软件自动保存验证（main 的 --autosave-test 模式专用）：
 * 打开目标文件 → 追加固定标记 → 触发 win.close()；预期自动保存后应用退出，不出现保存询问。
 * 文件落盘由 scripts/smoke.mjs 在进程退出后校验。
 */
async function runAutoSaveCloseTest({ win, cli }) {
  const marker = 'AUTO_SAVE_CLOSE_CHECK'
  const target = cli.autosaveTest || cli.open || null
  const result = await win.webContents.executeJavaScript(
    `(async () => {
      await window.__qm.ready
      const target = ${JSON.stringify(target)}
      for (let i = 0; i < 50; i += 1) {
        const state = window.__qm.getState()
        if (!target || state.filePath === target) break
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      const state = window.__qm.getState()
      if (target && state.filePath !== target) throw new Error('目标文件未打开：' + state.filePath)
      const editor = document.getElementById('editor')
      editor.focus()
      editor.value = editor.value + '\\n\\n' + ${JSON.stringify(marker)} + '\\n'
      editor.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((resolve) => setTimeout(resolve, 700))
      const next = window.__qm.getState()
      return { dirty: next.dirty, filePath: next.filePath }
    })()`,
    true
  )
  if (!result || result.dirty !== true) {
    throw new Error(`编辑后 dirty 预期为 true：${JSON.stringify(result)}`)
  }
  console.log('[autosave-test] 已编辑并触发窗口关闭：', JSON.stringify(result))
  win.close()
}

module.exports = { runE2E, runAutoSaveCloseTest }
