function Cipher(files, passphrase, algorithm, progress, callback) {
	if (!files || files.length == 0)
		return;

	var reader = new FileReader(),
		sliceSize, // number of bytes FileReader will read on each loop
		chunksize, // number of bytes Forge will cipher on each loop
		totalSize = 0,
		doneSize = 0,
		fileIndex = 0,
		fileEncrypted, fileSalt, fileIterations, fileKey, fileIV, fileCipher, fileOffset;

	// sliceSize is the number of bytes each FileReader.read*** call will load.
	// It only depends on available memory so 10MB seems OK
	sliceSize = 64 * 1024;//10 * 1024 * 1024;

	// chunkSize, is the number of bytes each Forge cipher call can use.
	// The method uses String.fromCharCode.apply(...) and thus, chunkSize is limited to the number of arguments.
	// Too large values would throw : "RangeError: arguments array passed to Function.prototype.apply is too large"
	// 64Ko seems OK on different browsers
	chunksize = 64 * 1024;

	// totalSize is the cumulative size of all files.
	// This is used to show progress
	$.each(files, function(index, file) {
		totalSize += file.size;
	});

	function cipherResult(event) {
		// event.target.result est :
		// - readAsDataURL: une chaine du type "data:text/plain;base64,dGVzdA0KYWJjDQojgCE="
		// - readAsArrayBuffer : un ArrayBuffer
		// - readAsBinaryString : une chaine binaire (pas très lisible)
		// - readAsText : une chaine (UTF-8 par défaut mais readAsText a un 2ème param)

		// Cipher a large "buffer" into smaller "chunks"
		var array = new Uint8Array(event.target.result);
		for (var i = 0; i < array.length; i += chunksize) {
			// Cipher chunk
			var chunk = array.slice(i, i + chunksize);
			fileCipher.update(forge.util.createBuffer(chunk));
			// Update progress
			doneSize += chunk.length;
			if (progress)
				progress.onprogress(doneSize, totalSize, chunk.length) 
		}
		// Move forward
		fileOffset += sliceSize;
		if (fileOffset < files[fileIndex].size)
			cipherNextChunk();
		else {
			var ok = fileCipher.finish();
			if (fileEncrypted) {
				if (ok)
					callback(files[fileIndex], fileIndex, fileCipher.output.getBytes());
				else
					alert('Le fichier ' + files[fileIndex].name + ' est corrompu ou le mot de passe est incorrect');
			} else {
				var cipherText = forge.util.bytesToHex(fileSalt) // 16 bytes
					+ '-' + fileIterations
					+ '-' + forge.util.bytesToHex(fileIV) // algorithm.blockSizeInBits / 8 bytes
					+ '-' + fileCipher.mode.tag.toHex() // algorithm.tagLengthInBits / 8 bytes
					+ '-' + fileCipher.output.data;
				callback(files[fileIndex], fileIndex, cipherText);
			}

			// Fichier suivant
			fileIndex++;
			if (fileIndex < files.length)
				cipherNextFile();
			else {
				// DONE !
				if (progress)
					progress.onstop();
			}
		}
	}

	function cipherNextChunk() {
		var chunk = files[fileIndex].slice(fileOffset, fileOffset + sliceSize);
		reader.readAsArrayBuffer(chunk);
	}

	function cipherNextFile() {
		fileEncrypted = Cipher.prototype.getFileEncrypted.apply(null, [files[fileIndex]]);
		if (fileEncrypted) {
			// On doit commencer par lire l'en-tête
			var headerSize = 1000;
			reader.onload = function(event) {
				var array = new Uint8Array(event.target.result),
					s = String.fromCharCode.apply(null, array),
					parts = s.split('-');
				// L'en-tête est <fileSalt en héxa>-<fileIterations>-<fileIV en héxa>-<fileTag en héxa>-<debut du fichier chiffré>
				fileSalt = forge.util.hexToBytes(parts[0]);
				fileIterations = parseInt(parts[1]);
				fileIV = forge.util.hexToBytes(parts[2]);
				fileTag = forge.util.hexToBytes(parts[3]);

				// Création d'une clef de la taille souhaitée, en utilisation PBKDF2WithHmacSHA1
				fileKey = forge.pkcs5.pbkdf2(passphrase, fileSalt, fileIterations, algorithm.keySizeInBits / 8, 'sha1');
				// OK, on a ce qu'il faut pour créer le cipher
				fileCipher = forge.cipher.createDecipher(algorithm.name, fileKey);
				fileCipher.start({
					iv: fileIV,
					tagLength: algorithm.tagLengthInBits,
					tag: fileTag
				});

				// Le début du texte est repris de "s" en retirant le début
				// parts[4] semblait évident mais en cas de caractères étranges, le split fonctionne mal et ne retourne pas tout (cf image de test)
				s = s.substring(parts[0].length + parts[1].length + parts[2].length + parts[3].length + 4);
				fileCipher.update(forge.util.createBuffer(s, 'raw'));

				// On peut commencer la lecture de la suite du fichier par blocs
				fileOffset = headerSize;
				reader.onload = cipherResult;
				cipherNextChunk();
			};
			var chunk = files[fileIndex].slice(0, headerSize);
			reader.readAsArrayBuffer(chunk);
		} else {
			// Génération d'un sel aléatoire de 16 octets, la recommandation étant d'au moins 64 bits (https://en.wikipedia.org/wiki/PBKDF2)
			fileSalt = forge.random.getBytesSync(16); // 16 octets
			// Utilisation de 10 000 itérations car 1000 à l'origine mais monte d'années en années (https://en.wikipedia.org/wiki/PBKDF2)
			fileIterations = 10000; // 10 000 itérations
			// Création d'une clef de la taille souhaitée, en utilisation PBKDF2WithHmacSHA1
			fileKey = forge.pkcs5.pbkdf2(passphrase, fileSalt, fileIterations, algorithm.keySizeInBits / 8, 'sha1');
			// Génération d'un IV aléatoire dont la taille dépend de la taille de bloc
			fileIV = forge.random.getBytesSync(algorithm.blockSizeInBits / 8);
			// On commence la lecture à partir du 1er octet
			fileOffset = 0;

			// OK, on a ce qu'il faut pour créer le cipher
			fileCipher = forge.cipher.createCipher(algorithm.name, fileKey);
			fileCipher.start({
				iv: fileIV,
				tagLength: algorithm.tagLengthInBits
			});
			// On peut commencer la lecture du fichier
			reader.onload = cipherResult;
			cipherNextChunk();
		}
	}

	if (progress)
		progress.onstart();
	cipherNextFile();
}

Cipher.prototype.getFileEncrypted = function(file) {
	return file.name.lastIndexOf('.enc') === file.name.length - 4;
}

/**
 * Classe responsable de l'affichage de la progression.
 * 
 * NB : on n'utilise pas les classes de Bootstrap "progress" et "progress-bar" car le dessin fait perdre un temps non négligeable (par exemple : 8.8s -> 10.8s).
 * Si toutefois on le voulait, il suffirait d'ajouter les classes aux 2 div et de retirer le style dans la feuille CSS.
 */
function Progress(progressBar) {
	var progressPct, progressInterval;
	function refresh() {
		progressBar.attr('aria-valuenow', progressPct.toFixed(0)).css('width', progressPct + '%').html('&nbsp;' + progressPct.toFixed(0) + '%');
	}
	this.onstart = function() {
		progressBar.attr('aria-valuenow', '0').css('width', '0').html('');
		progressBar.parent().show();
		progressPct = 0;
		progressInterval = setInterval(refresh, 200);
	};
	this.onprogress = function(done, total, step) {
		progressPct = done * 100.0 / total;
	};
	this.onstop = function() {
		clearInterval(progressInterval);
		progressInterval = undefined;
		progressPct = undefined;
		progressBar.parent().hide();
	};
}

function formatFileSize(size) {
	if (size < 1024)
		return size.toString();
	if (size < 1024 * 1024)
		return (size / 1024).toPrecision(3) + ' Ko';
	if (size < 1024 * 1024 * 1024)
		return (size / 1024 / 1024).toPrecision(3) + ' Mo';
	return (size / 1024 / 1024 / 1024).toPrecision(3) + ' Go';
}

function addFiles(files) {
	if (!files || files.length == 0)
		return;

	$('#cipher-launch-button, #cipher-clear-button').show();

	$.each(files, function(index, file) {
		var encrypted = Cipher.prototype.getFileEncrypted.apply(null, [file]);
		var resultname = encrypted ? file.name.substring(0, file.name.length - 4) : (file.name + '.enc');

		var tr = $('<tr />').data('file', file)
			.append('<td>' + file.name + '</td>')
			.append('<td>' + formatFileSize(file.size) + '</td>')
			.append('<td><input type="checkbox" class="status" /></td>')
			.append('<td><a class="download btn btn-link" href="#" download="' + resultname + '">Télécharger</a></td>')
			.appendTo('#cipher-table > tbody');

		tr.find('input:checkbox').prop('checked', encrypted).bootstrapSwitch({
			onText: 'Chiffré',
			onColor: 'success',
			offText: 'Déchiffré',
			offColor: 'warning'
		});
	});
}

$(function() {
	$('#cipher-files-button').on('click', function() {
		$('#cipher-files-input').click();
	});

	$('#cipher-files-input').on('change', function() {
		addFiles(this.files);
	});

	$('body').on('dragover', function(event) {
		event.stopPropagation();
		event.preventDefault();
		event.originalEvent.dataTransfer.dropEffect = 'copy';
	}).on('drop', function(event) {
		event.stopPropagation();
		event.preventDefault();
		addFiles(event.originalEvent.dataTransfer.files);
	});

	$('#cipher-launch-button').on('click', function() {
		var modal = $('#cipher-passphrase-modal'),
			input = modal.find('input').val('');
		modal.modal('show');
	});

	$('#cipher-passphrase-modal').on('shown.bs.modal', function(e) {
		$('#cipher-passphrase-input').focus();
	}).on('keypress', function(event) {
		var keyCode = event.which || event.keyCode;
		if (keyCode == 13) {
			$('#cipher-validate-button').click(); // Enter -> Valider
		} else if (keyCode == 27) {
			$(this).modal('hide'); // Escape -> Annuler
		}
	});

	$('#cipher-validate-button').click(function() {
		var input = $('#cipher-passphrase-input').focus(),
			passphrase = input.val();

		input.parent().toggleClass('has-error', !passphrase);
		if (!passphrase)
			return;

		var rows = $('#cipher-table > tbody > tr:not(.success)').get(),
			files = rows.map(function(tr) { return $(tr).data('file'); }),
			algorithm = {
				name: 'AES-GCM',
				title: 'AES-GCM (256 bits)',
				blockSizeInBits: 128,
				keySizeInBits: 256,
				tagLengthInBits: 128
			};

		$('#cipher-passphrase-modal').modal('hide');
		new Cipher(files, passphrase, algorithm, new Progress($('#cipher-progress').children()), function(file, index, cipherText) {
			$(rows[index]).addClass('success').find('a.download').attr('href', 'data:text/plain;base64,' + forge.util.encode64(cipherText));
		});
	});

	$('#cipher-clear-button').on('click', function() {
		$('#cipher-table > tbody').empty();
		$('#cipher-launch-button, #cipher-clear-button').hide();
	});
});