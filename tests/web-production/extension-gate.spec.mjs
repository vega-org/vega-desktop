import {test, expect} from '@playwright/test';
import {installTestBrowserExtension} from '../helpers/browser-extension.mjs';
const store = 'https://chromewebstore.google.com/detail/vega/iofleagpffjfcaegclkgbjjfeoinmjhe';

test('app stays accessible without extension and only adding a source opens the prompt', async ({page}, testInfo) => {
  await page.goto('/');
  await expect(page.getByRole('heading', {name:'Welcome to Vega'})).toBeVisible();
  await page.goto('/settings');
  await expect(page.getByRole('heading', {name:'Settings', exact:true})).toBeVisible();
  await expect(page.getByRole('button', {name:'Download Extension', exact:true})).toBeVisible();
  await page.goto('/extensions');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByTitle('Add provider source', {exact:true}).click();
  const prompt = page.getByRole('dialog', {name:'Recommended: install the Vega extension'});
  await expect(prompt).toBeVisible();
  await expect(page.getByRole('textbox', {name:'Provider source'})).toHaveCount(0);
  await page.route(store, route=>route.fulfill({contentType:'text/html',body:'Extension store fixture'}));
  const opened = page.waitForEvent('popup');
  await prompt.getByRole('button', {name:'Install extension', exact:true}).click();
  const popup = await opened;
  await expect(popup).toHaveURL(store);
  await popup.close();
  await page.screenshot({path:testInfo.outputPath('extension-prompt-desktop.png')});
  await page.setViewportSize({width:375,height:812});
  await expect(prompt.getByRole('button',{name:'Cancel'})).toBeInViewport();
  await page.screenshot({path:testInfo.outputPath('extension-prompt-mobile.png')});
  await prompt.getByRole('button',{name:'Cancel'}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('navigation', {name:'Main navigation'}).getByRole('button',{name:'Settings', exact:true}).click();
  await expect(page.getByRole('heading', {name:'Settings',exact:true})).toBeVisible();
});

test('connecting the extension opens the source form and disconnecting leaves the app available', async ({page}) => {
  await page.goto('/extensions');
  await page.getByTitle('Add provider source',{exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Recommended: install the Vega extension'})).toBeVisible();
  await page.evaluate(installTestBrowserExtension);
  await expect(page.getByRole('dialog',{name:'Add source',exact:true})).toBeVisible();
  await expect(page.getByRole('textbox',{name:'Provider source'})).toBeVisible();
  await page.evaluate(()=>{delete window.vegaPlatformHost;window.dispatchEvent(new Event('vega-platform-host-change'));});
  await expect(page.getByRole('dialog',{name:'Recommended: install the Vega extension'})).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.layout-root')).toBeVisible();
});

test('installing a listed provider also prompts when the extension is missing', async ({page}) => {
  await page.addInitScript(()=>{
    const source = {author:'fixture',url:'https://fixture.vega.example',isDefault:true};
    const provider = {value:'fixture',display_name:'Test provider',version:'1.0.0',type:'global',installed:false,disabled:false,icon:'',source};
    localStorage.setItem('providerSources',JSON.stringify([source]));
    localStorage.setItem('availableProviders',JSON.stringify([provider]));
    localStorage.setItem('availableProviders_fixture',JSON.stringify([provider]));
  });
  await page.goto('/extensions');
  await page.getByRole('button',{name:'Install',exact:true}).click();
  const prompt = page.getByRole('dialog',{name:'Recommended: install the Vega extension'});
  await expect(prompt).toBeVisible();
  await prompt.getByRole('button',{name:'Cancel'}).click();
  await expect(page.getByRole('button',{name:'Install',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('installedProviders')||'[]'))).toEqual([]);
  await page.route('**/api/proxy/**', async route => {
    if (route.request().url().endsWith('/session')) return route.fulfill({json: {ok: true}});
    const input = route.request().postDataJSON();
    const text = 'exports.catalog=[]; exports.genres=[]; exports.getPosts=async()=>[]; exports.getSearchPosts=async()=>[]; exports.getMeta=async()=>({}); exports.getStream=async()=>[]; exports.getEpisodes=async()=>[]; exports.getSettingsSchema=async()=>[];';
    return route.fulfill({json: {url: input.url, status: 200, headers: [], body: [...new TextEncoder().encode(text)]}});
  });
  await page.getByRole('button', {name: 'Install', exact: true}).click();
  await prompt.getByRole('button', {name: 'Skip and use proxy'}).click();
  await expect(page.getByText('In use', {exact: true})).toBeVisible();
});

test('skipping the recommendation adds a source and installs its provider through the proxy', async ({page}) => {
  const calls = [];
  await page.route('**/api/proxy/**', async route => {
    const action = new URL(route.request().url()).pathname.split('/').pop();
    if (action === 'session') return route.fulfill({json: {ok: true}});
    const input = route.request().postDataJSON();
    calls.push(input.url);
    let text;
    if (input.url.includes('manifest.json')) text = JSON.stringify([{value: 'fixture', display_name: 'Proxy Test Provider', version: '1.0.0', type: 'global'}]);
    else text = 'exports.catalog=[]; exports.genres=[]; exports.getPosts=async()=>[]; exports.getSearchPosts=async()=>[]; exports.getMeta=async()=>({}); exports.getStream=async()=>[]; exports.getEpisodes=async()=>[]; exports.getSettingsSchema=async()=>[];';
    return route.fulfill({json: {url: input.url, status: 200, headers: [['Content-Type', 'text/plain']], body: [...new TextEncoder().encode(text)]}});
  });
  await page.goto('/extensions');
  await page.getByTitle('Add provider source', {exact: true}).click();
  const prompt = page.getByRole('dialog', {name: 'Recommended: install the Vega extension'});
  await prompt.getByRole('button', {name: 'Skip and use proxy'}).click();
  await expect(page.getByRole('dialog', {name: 'Add source', exact: true})).toBeVisible();
  await page.getByRole('textbox', {name: 'Provider source'}).click();
  await page.getByRole('textbox', {name: 'Provider source'}).fill('https://fixture.vega.example/manifest.json');
  await page.getByRole('button', {name: 'Add source', exact: true}).click();
  await expect(page.getByText('Proxy Test Provider', {exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'Install', exact: true}).click();
  await expect(page.getByText('In use', {exact: true})).toBeVisible();
  expect(calls.some(url => url.includes('/posts.js'))).toBe(true);
  await page.reload();
  expect(await page.evaluate(() => localStorage.getItem('vega_web_proxy_enabled'))).toBe('true');
  await expect(page.getByRole('dialog', {name: 'Recommended: install the Vega extension'})).toHaveCount(0);
});

test('installed extension without permission prompts for website access even when proxy was enabled', async ({page}) => {
  await page.addInitScript(() => {
    localStorage.setItem('vega_web_proxy_enabled', 'true');
    window.__vegaBrowserBridge = true;
    window.vegaPlatformHostReady = Promise.resolve();
  });
  await page.goto('/');
  const prompt = page.getByRole('dialog', {name: 'Allow website access in the Vega extension'});
  await expect(prompt).toBeVisible();
  await expect(prompt.getByRole('button', {name: 'Skip and use proxy'})).toHaveCount(0);
  await expect(prompt.getByRole('button', {name: 'Install extension'})).toHaveCount(0);
  await page.evaluate(installTestBrowserExtension);
  await expect(prompt).toHaveCount(0);
});
