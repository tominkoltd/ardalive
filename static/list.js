window.onload = () => {
	loadList()
}
async function loadList() {
	const workspaces = await (await fetch("/fl.json")).json()
	if (workspaces.length == 0) {
		return
	}

	const cont = document.getElementsByTagName('flist')[0]
	cont.innerHTML = ""

	for (const folder of workspaces) {
		const workSpaceFolder = document.createElement("div")
		workSpaceFolder.innerHTML = folder.name
		if (folder.scheme) {
			workSpaceFolder.setAttribute("scheme", folder.scheme)
		}
		cont.appendChild(workSpaceFolder)
		for (const file of folder.files) {
			const fileLink = document.createElement("a")
			fileLink.href = folder.name+"/"+file
			fileLink.innerHTML = file
			cont.appendChild(fileLink)
		}
	}
}