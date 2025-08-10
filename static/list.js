window.onload = () => {
	loadList()
	document.cookie = "ArdaLive=; Path=/; HttpOnly; SameSite=Lax";
}
async function loadList() {
	const files = await (await fetch("/fl.json")).json()
	if (files.length == 0) {
		return
	}
	const commonPath = files.reduce((acc, file) => {
		let i = 0;
		while (i < acc.length && i < file.length && acc[i] === file[i]) i++;
		return acc.slice(0, i);
	});
	const prefix = commonPath.slice(0, commonPath.lastIndexOf("/") + 1);

	let result = files.map((path, idx) => ({
		position: idx,
		name: path.replace(prefix, ""),
		path
	}));

	result.sort((a, b) => {
		const aHasFolder = a.name.includes("/");
		const bHasFolder = b.name.includes("/");
		if (aHasFolder !== bHasFolder) return aHasFolder - bHasFolder;
		return a.name.localeCompare(b.name);
	});

	const cont = document.getElementsByTagName('flist')[0]
	cont.innerHTML = ""
	for (const file of result) {
		const fileLink = document.createElement("a")
		fileLink.href = file.path
		fileLink.innerHTML = file.name
		cont.appendChild(fileLink)
	}
}