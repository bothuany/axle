// The shipped product.json points the Extensions view at Open VSX (editor/patches/flow-core.patch); this dev
// checkout's does not. Give the web client the same gallery configuration the product ships.
const gallery = {
	extensionsGallery: {
		serviceUrl: 'https://open-vsx.org/vscode/gallery',
		itemUrl: 'https://open-vsx.org/vscode/item',
		latestUrlTemplate: 'https://open-vsx.org/vscode/gallery/{publisher}/{name}/latest',
		controlUrl: 'https://raw.githubusercontent.com/EclipseFdn/publish-extensions/refs/heads/master/extension-control/extensions.json',
	},
	extensionUrlTemplate: 'https://open-vsx.org/vscode/gallery/{publisher}/{name}/latest',
}
await p.route(u => u.pathname === '/' , async route => {
	const r = await route.fetch()
	let t = await r.text()
	t = t.replace('&quot;productConfiguration&quot;:{', '&quot;productConfiguration&quot;:' + JSON.stringify(gallery).slice(0, -1).replace(/"/g, '&quot;') + ',')
	await route.fulfill({ response: r, body: t })
})
await p.reload(); await p.waitForSelector('.monaco-workbench'); await sleep(9000)
return 'reloaded'
