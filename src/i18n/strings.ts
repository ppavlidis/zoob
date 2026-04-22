// Side-by-side translation table. Every user-facing string lives here with
// `{ en, fr, es }` keyed so you can eyeball one line across all three locales
// instead of chasing per-locale files. If a key is missing a locale, `t()`
// falls back to the English entry rather than crashing.
//
// Placeholder syntax is `${name}`. Runtime substitution is a dumb string
// replace — no formatting, no types. Plurals are expressed as sibling keys
// `foo_one` / `foo_other` and selected through `plural(n, 'foo_one', 'foo_other')`.
//
// Proper nouns kept untranslated: "Zotero", "Better BibTeX", "Obsidian",
// "zoob", "Semantic Scholar", "CSL", "JSON-RPC", and CSL-style dropdown
// labels (AMA / APA 7 / MLA 9 / etc. — those are formal style names).

export interface Triple {
  en: string;
  fr: string;
  es: string;
}

export const STRINGS = {
  // -- Ribbon + menus + commands -------------------------------------------
  "ribbon.tooltip": {
    en: "zoob: references",
    fr: "zoob : références",
    es: "zoob: referencias",
  },
  "menu.insertFromZotero": {
    en: "Insert citation from Zotero…",
    fr: "Insérer une citation depuis Zotero…",
    es: "Insertar cita desde Zotero…",
  },
  "cmd.openPanel": {
    en: "Open references panel",
    fr: "Ouvrir le panneau des références",
    es: "Abrir el panel de referencias",
  },
  "cmd.insertCitation": {
    en: "Insert citation",
    fr: "Insérer une citation",
    es: "Insertar cita",
  },
  "cmd.insertViaPicker": {
    en: "Insert citation from Zotero (picker dialog)",
    fr: "Insérer une citation depuis Zotero (boîte de dialogue)",
    es: "Insertar cita desde Zotero (selector)",
  },
  "cmd.insertRefsBlock": {
    en: "Insert references block",
    fr: "Insérer un bloc de références",
    es: "Insertar bloque de referencias",
  },
  "cmd.refreshCurrent": {
    en: "Refresh Zotero data for current note",
    fr: "Actualiser les données Zotero pour la note courante",
    es: "Actualizar datos de Zotero para la nota actual",
  },
  "cmd.refreshAll": {
    en: "Refresh Zotero data (entire cache)",
    fr: "Actualiser les données Zotero (cache entier)",
    es: "Actualizar datos de Zotero (caché completo)",
  },
  "cmd.openInZotero": {
    en: "Open item in Zotero (citation under cursor)",
    fr: "Ouvrir l'élément dans Zotero (citation sous le curseur)",
    es: "Abrir el ítem en Zotero (cita bajo el cursor)",
  },
  "cmd.openAttachment": {
    en: "Open attachment (citation under cursor)",
    fr: "Ouvrir la pièce jointe (citation sous le curseur)",
    es: "Abrir el adjunto (cita bajo el cursor)",
  },
  "cmd.insertMetaBlock": {
    en: "Insert item metadata block (citation under cursor)",
    fr: "Insérer le bloc de métadonnées (citation sous le curseur)",
    es: "Insertar bloque de metadatos (cita bajo el cursor)",
  },
  "cmd.copyCslJson": {
    en: "Copy item as CSL-JSON (citation under cursor)",
    fr: "Copier l'élément en CSL-JSON (citation sous le curseur)",
    es: "Copiar el ítem como CSL-JSON (cita bajo el cursor)",
  },

  // -- Notices -------------------------------------------------------------
  "notice.unknownAction": {
    en: 'zoob: unknown action "${action}"',
    fr: "zoob : action inconnue « ${action} »",
    es: "zoob: acción desconocida «${action}»",
  },
  "notice.suggestError": {
    en: "zoob suggest: ${message}",
    fr: "zoob (autocomplétion) : ${message}",
    es: "zoob (sugerencias): ${message}",
  },
  "notice.noEditor": {
    en: "No active markdown editor.",
    fr: "Aucun éditeur Markdown actif.",
    es: "No hay un editor Markdown activo.",
  },
  "notice.pickInZotero": {
    en: "Pick a reference in Zotero…",
    fr: "Choisissez une référence dans Zotero…",
    es: "Elige una referencia en Zotero…",
  },
  "notice.pickerFailed": {
    en: "Zotero picker failed: ${message}",
    fr: "Le sélecteur Zotero a échoué : ${message}",
    es: "El selector de Zotero falló: ${message}",
  },
  "notice.noZoteroLink": {
    en: "No Zotero link for @${citekey}",
    fr: "Pas de lien Zotero pour @${citekey}",
    es: "No hay enlace a Zotero para @${citekey}",
  },
  "notice.genericError": {
    en: "zoob: ${message}",
    fr: "zoob : ${message}",
    es: "zoob: ${message}",
  },
  "notice.noCitationUnderCursor": {
    en: "No citation under cursor.",
    fr: "Aucune citation sous le curseur.",
    es: "No hay una cita bajo el cursor.",
  },
  "notice.noZoteroItem": {
    en: "No Zotero item for @${citekey}",
    fr: "Aucun élément Zotero pour @${citekey}",
    es: "No se encontró el ítem de Zotero para @${citekey}",
  },
  "notice.noZoteroKey": {
    en: "No Zotero item key available.",
    fr: "Aucune clé d'élément Zotero disponible.",
    es: "No hay clave de ítem de Zotero disponible.",
  },
  "notice.noPdf": {
    en: "No PDF attachment on this item.",
    fr: "Pas de PDF joint à cet élément.",
    es: "Este ítem no tiene ningún PDF adjunto.",
  },
  "notice.putCursorOnCite": {
    en: "Put the cursor on a [@citekey] first.",
    fr: "Placez d'abord le curseur sur un [@citekey].",
    es: "Coloca primero el cursor sobre un [@citekey].",
  },
  "notice.cslCopied": {
    en: "Copied CSL-JSON for @${citekey}",
    fr: "CSL-JSON copié pour @${citekey}",
    es: "CSL-JSON copiado para @${citekey}",
  },
  "notice.citekeyCopied": {
    en: "Copied [@${citekey}]",
    fr: "[@${citekey}] copié",
    es: "[@${citekey}] copiado",
  },
  "notice.refreshNoFile": {
    en: "zoob: no matching note to refresh",
    fr: "zoob : aucune note à actualiser",
    es: "zoob: no hay ninguna nota coincidente para actualizar",
  },
  "notice.refreshed_one": {
    en: "zoob: refreshed ${count} citekey for ${label}",
    fr: "zoob : ${count} citekey actualisée pour ${label}",
    es: "zoob: ${count} citekey actualizada para ${label}",
  },
  "notice.refreshed_other": {
    en: "zoob: refreshed ${count} citekeys for ${label}",
    fr: "zoob : ${count} citekeys actualisées pour ${label}",
    es: "zoob: ${count} citekeys actualizadas para ${label}",
  },
  // Used inside the refreshed Notice when multiple notes were refreshed at once.
  "notice.refreshed.multiNote": {
    en: "${count} notes",
    fr: "${count} notes",
    es: "${count} notas",
  },
  "notice.cacheCleared": {
    en: "zoob: full cache cleared",
    fr: "zoob : cache entièrement vidé",
    es: "zoob: caché vaciado por completo",
  },
  "notice.noZoteroKeyForCite": {
    en: "No Zotero item key available for this citation.",
    fr: "Aucune clé d'élément Zotero disponible pour cette citation.",
    es: "No hay clave de ítem de Zotero para esta cita.",
  },
  "notice.attachmentNoKey": {
    en: "This attachment has no Zotero key; opening with system default.",
    fr: "Cette pièce jointe n'a pas de clé Zotero ; ouverture avec l'application par défaut.",
    es: "Este adjunto no tiene clave de Zotero; se abre con la app predeterminada.",
  },
  "notice.pdfNotInVault": {
    en: "PDF is not inside the vault — opening with system default.",
    fr: "Le PDF n'est pas dans le coffre — ouverture avec l'application par défaut.",
    es: "El PDF no está en la bóveda — se abre con la app predeterminada.",
  },
  "notice.cannotOpenAttachment": {
    en: "No way to open this attachment.",
    fr: "Impossible d'ouvrir cette pièce jointe.",
    es: "No se puede abrir este adjunto.",
  },
  "notice.openNoteForQuote": {
    en: "Open a note to insert the quote.",
    fr: "Ouvrez une note pour insérer la citation.",
    es: "Abre una nota para insertar la cita.",
  },
  "notice.copiedFormatted": {
    en: "Copied formatted reference",
    fr: "Référence formatée copiée",
    es: "Referencia formateada copiada",
  },
  "notice.couldNotFormat": {
    en: "Couldn't format: ${message}",
    fr: "Formatage impossible : ${message}",
    es: "No se pudo formatear: ${message}",
  },

  // -- Settings: intro + language -----------------------------------------
  "settings.intro": {
    en: "Zotero bibliography inside Obsidian via Better BibTeX. Zotero must be running with the Better BibTeX extension installed.",
    fr: "Bibliographie Zotero dans Obsidian via Better BibTeX. Zotero doit être lancé avec l'extension Better BibTeX installée.",
    es: "Bibliografía de Zotero en Obsidian mediante Better BibTeX. Zotero debe estar en ejecución con la extensión Better BibTeX instalada.",
  },
  "settings.language.name": {
    en: "Language",
    fr: "Langue",
    es: "Idioma",
  },
  "settings.language.desc": {
    en: "Interface language for panels, menus, and notices. Auto follows your system language.",
    fr: "Langue de l'interface pour les panneaux, menus et notifications. « Auto » suit la langue du système.",
    es: "Idioma de la interfaz para paneles, menús y notificaciones. «Auto» sigue el idioma del sistema.",
  },
  "settings.language.auto": {
    en: "Auto (system)",
    fr: "Auto (système)",
    es: "Auto (sistema)",
  },

  // -- Settings: BBT endpoint + connection test ---------------------------
  "settings.bbt.name": {
    en: "Better BibTeX endpoint",
    fr: "Point d'accès Better BibTeX",
    es: "Endpoint de Better BibTeX",
  },
  "settings.bbt.desc": {
    en: "JSON-RPC URL. Leave as default unless you've remapped Zotero's port.",
    fr: "URL JSON-RPC. À laisser par défaut sauf si vous avez remappé le port de Zotero.",
    es: "URL JSON-RPC. Deja el valor por defecto salvo que hayas cambiado el puerto de Zotero.",
  },
  "settings.test.name": {
    en: "Test connection",
    fr: "Tester la connexion",
    es: "Probar conexión",
  },
  "settings.test.desc": {
    en: "Pings the BBT endpoint and a Zotero-local-API fallback. Useful for diagnosing panel errors.",
    fr: "Interroge l'endpoint BBT et l'API locale Zotero en secours. Utile pour diagnostiquer les erreurs du panneau.",
    es: "Consulta el endpoint de BBT y la API local de Zotero como respaldo. Útil para diagnosticar errores del panel.",
  },
  "settings.test.run": {
    en: "Run test",
    fr: "Lancer le test",
    es: "Ejecutar prueba",
  },
  "settings.test.running": {
    en: "Testing…",
    fr: "Test en cours…",
    es: "Probando…",
  },
  "settings.test.ok": {
    en: "✓ OK — zoob is wired up correctly.",
    fr: "✓ OK — zoob est correctement branché.",
    es: "✓ OK — zoob está bien conectado.",
  },
  "settings.test.fail": {
    en: "✗ FAIL — Zotero or Better BibTeX isn't responding. Make sure Zotero is running and BBT is installed.",
    fr: "✗ ÉCHEC — Zotero ou Better BibTeX ne répond pas. Assurez-vous que Zotero est lancé et que BBT est installé.",
    es: "✗ FALLO — Zotero o Better BibTeX no responde. Asegúrate de que Zotero esté en ejecución y BBT instalado.",
  },
  "settings.test.unreachable": {
    en: "✗ FAIL — couldn't reach the BBT endpoint.",
    fr: "✗ ÉCHEC — impossible de joindre l'endpoint BBT.",
    es: "✗ FALLO — no se pudo contactar con el endpoint de BBT.",
  },
  "settings.test.corsUnusual": {
    en: "ℹ Unusual: CORS is normally blocking. Not a problem.",
    fr: "ℹ Inhabituel : CORS bloque normalement. Rien d'anormal.",
    es: "ℹ Inusual: CORS suele bloquear esto. No es un problema.",
  },
  "settings.test.corsExpected": {
    en: "✓ Expected — zoob doesn't use native fetch.",
    fr: "✓ Attendu — zoob n'utilise pas fetch natif.",
    es: "✓ Esperado — zoob no usa fetch nativo.",
  },
  "settings.test.zoteroOk": {
    en: "✓ Zotero's local server is reachable (any HTTP status here means it's up).",
    fr: "✓ Le serveur local de Zotero répond (n'importe quel statut HTTP ici signifie qu'il est actif).",
    es: "✓ El servidor local de Zotero responde (cualquier código HTTP aquí significa que está activo).",
  },
  "settings.test.zoteroDown": {
    en: "✗ Zotero's local server isn't answering — is Zotero running?",
    fr: "✗ Le serveur local de Zotero ne répond pas — Zotero est-il lancé ?",
    es: "✗ El servidor local de Zotero no responde — ¿está Zotero en ejecución?",
  },
  "settings.test.verdictOk": {
    en: "Overall: ✓ healthy. zoob will work. [2] and [3] are diagnostics, not failures.",
    fr: "Bilan : ✓ en bonne santé. zoob fonctionnera. [2] et [3] sont des diagnostics, pas des échecs.",
    es: "Resultado: ✓ correcto. zoob funcionará. [2] y [3] son diagnósticos, no fallos.",
  },
  "settings.test.verdictFail": {
    en: "Overall: ✗ not healthy. zoob needs [1] to pass. See the hint on that row.",
    fr: "Bilan : ✗ problème. zoob a besoin que [1] réussisse. Voir l'indication sur cette ligne.",
    es: "Resultado: ✗ con problemas. zoob necesita que pase [1]. Mira la pista de esa línea.",
  },

  // -- Settings: panel density + sort -------------------------------------
  "settings.density.name": {
    en: "Bibliography density",
    fr: "Densité de la bibliographie",
    es: "Densidad de la bibliografía",
  },
  "settings.density.desc": {
    en: "Compact shows one-line rows. Detailed shows rich cards with abstract, tags, annotations, and full actions.",
    fr: "Compacte : lignes d'une seule ligne. Détaillée : cartes riches avec résumé, tags, annotations et actions complètes.",
    es: "Compacta: una línea por entrada. Detallada: fichas con resumen, etiquetas, anotaciones y todas las acciones.",
  },
  "settings.density.compact": {
    en: "Compact",
    fr: "Compacte",
    es: "Compacta",
  },
  "settings.density.detailed": {
    en: "Detailed",
    fr: "Détaillée",
    es: "Detallada",
  },
  "settings.sort.name": {
    en: "Bibliography sort order",
    fr: "Ordre de tri de la bibliographie",
    es: "Orden de la bibliografía",
  },
  "settings.sort.desc": {
    en: "Order of entries in the side panel. Cite order follows first occurrence of each citekey in the note; author order sorts alphabetically by first author, then year.",
    fr: "Ordre des entrées dans le panneau latéral. L'ordre de citation suit la première occurrence de chaque citekey dans la note ; l'ordre par auteur trie alphabétiquement par premier auteur, puis par année.",
    es: "Orden de las entradas en el panel lateral. «Orden de cita» sigue la primera aparición de cada citekey en la nota; «por autor» ordena alfabéticamente por primer autor y luego por año.",
  },
  "settings.sort.document": {
    en: "Cite order in document",
    fr: "Ordre de citation dans le document",
    es: "Orden de cita en el documento",
  },
  "settings.sort.author": {
    en: "Alphabetical by first author",
    fr: "Alphabétique par premier auteur",
    es: "Alfabético por primer autor",
  },

  // -- Settings: PDF open target ------------------------------------------
  "settings.pdf.name": {
    en: "PDF open target",
    fr: "Ouverture des PDF",
    es: "Destino al abrir PDF",
  },
  "settings.pdf.desc": {
    en: "Where the Open PDF button sends attachments. Alt-click on a card toggles to the non-default target.",
    fr: "Où le bouton « Ouvrir le PDF » envoie les pièces jointes. Alt-clic sur une carte bascule vers l'autre destination.",
    es: "Dónde abre los adjuntos el botón «Abrir PDF». Alt-clic en una ficha alterna al destino opuesto.",
  },
  "settings.pdf.zotero": {
    en: "Zotero reader (default)",
    fr: "Lecteur Zotero (par défaut)",
    es: "Lector de Zotero (por defecto)",
  },
  "settings.pdf.system": {
    en: "System default app",
    fr: "Application système par défaut",
    es: "App predeterminada del sistema",
  },
  "settings.pdf.obsidian": {
    en: "Obsidian tab (only if file is in the vault)",
    fr: "Onglet Obsidian (uniquement si le fichier est dans le coffre)",
    es: "Pestaña de Obsidian (solo si el archivo está en la bóveda)",
  },

  // -- Settings: citation style -------------------------------------------
  "settings.style.name": {
    en: "Citation style",
    fr: "Style de citation",
    es: "Estilo de citación",
  },
  "settings.style.desc": {
    en: "Style used for the references panel, hover card footer, and the ::: {#refs} block.",
    fr: "Style utilisé pour le panneau des références, le pied de la carte de survol et le bloc ::: {#refs}.",
    es: "Estilo usado en el panel de referencias, el pie de la tarjeta emergente y el bloque ::: {#refs}.",
  },
  "settings.styleCustom.name": {
    en: "Custom CSL style ID",
    fr: "ID de style CSL personnalisé",
    es: "ID de estilo CSL personalizado",
  },
  "settings.styleCustom.desc": {
    en: "Overrides the dropdown. Any style ID Zotero recognizes (e.g. http://www.zotero.org/styles/nature).",
    fr: "Remplace le menu déroulant. N'importe quel ID de style reconnu par Zotero (ex. http://www.zotero.org/styles/nature).",
    es: "Sobrescribe el menú. Cualquier ID de estilo reconocido por Zotero (p. ej. http://www.zotero.org/styles/nature).",
  },
  "settings.styleCustom.placeholder": {
    en: "leave blank to use the dropdown",
    fr: "laissez vide pour utiliser le menu",
    es: "déjalo en blanco para usar el menú",
  },

  // -- Settings: author compaction ----------------------------------------
  "settings.authorCompact.name": {
    en: "Compact long author lists",
    fr: "Compacter les longues listes d'auteurs",
    es: "Compactar listas largas de autores",
  },
  "settings.authorCompact.desc": {
    en: "When an item has more than this many authors, the bibliography entry shows only the first N, a “…”, and the last author (which is often the senior author). Set to 0 to disable.",
    fr: "Lorsqu'un élément dépasse ce nombre d'auteurs, l'entrée n'affiche que les N premiers, un « … » et le dernier auteur (souvent l'auteur principal). 0 pour désactiver.",
    es: "Cuando un ítem supera este número de autores, la entrada muestra solo los primeros N, un «…» y el último autor (a menudo el autor principal). Usa 0 para desactivar.",
  },
  "settings.authorKeep.name": {
    en: "Authors to keep at the start",
    fr: "Auteurs à conserver en début",
    es: "Autores a mantener al principio",
  },
  "settings.authorKeep.desc": {
    en: "When compacting, how many leading authors to show before the “…”.",
    fr: "Lors de la compaction, nombre d'auteurs affichés avant le « … ».",
    es: "Al compactar, cuántos autores iniciales se muestran antes del «…».",
  },

  // -- Settings: Semantic Scholar -----------------------------------------
  "settings.s2.name": {
    en: "Show Semantic Scholar citation counts",
    fr: "Afficher les nombres de citations Semantic Scholar",
    es: "Mostrar recuentos de citas de Semantic Scholar",
  },
  "settings.s2.desc": {
    en: 'When on, hover cards show a "Cited by N" badge fetched from Semantic Scholar\'s free graph API. Off by default to be kind to their shared, rate-limited public endpoint.',
    fr: "Quand activé, les cartes de survol affichent un badge « Cité par N » récupéré depuis l'API graph gratuite de Semantic Scholar. Désactivé par défaut, pour ménager leur endpoint public partagé et limité.",
    es: "Cuando está activado, las tarjetas emergentes muestran una insignia «Citado por N» obtenida de la API graph gratuita de Semantic Scholar. Desactivado por defecto para no saturar su endpoint público compartido y limitado.",
  },
  "settings.s2ttl.name": {
    en: "Refresh citation counts every",
    fr: "Actualiser les nombres de citations tous les",
    es: "Actualizar los recuentos cada",
  },
  "settings.s2ttl.never": {
    en: "Never after the first successful check — keeps S2 traffic to a minimum. Click a `?` badge to force a retry on individual items.",
    fr: "Jamais après la première vérification réussie — trafic S2 minimal. Cliquez sur un badge « ? » pour forcer une relance sur un élément.",
    es: "Nunca tras la primera verificación exitosa — mantiene el tráfico a S2 al mínimo. Haz clic en una insignia «?» para forzar un reintento de un ítem concreto.",
  },
  "settings.s2ttl.desc_one": {
    en: "${days} day — a cached count is re-fetched from Semantic Scholar after this window expires.",
    fr: "${days} jour — un nombre mis en cache est récupéré à nouveau auprès de Semantic Scholar après l'expiration de cette fenêtre.",
    es: "${days} día — un recuento en caché se vuelve a pedir a Semantic Scholar al expirar esta ventana.",
  },
  "settings.s2ttl.desc_other": {
    en: "${days} days — a cached count is re-fetched from Semantic Scholar after this window expires.",
    fr: "${days} jours — un nombre mis en cache est récupéré à nouveau auprès de Semantic Scholar après l'expiration de cette fenêtre.",
    es: "${days} días — un recuento en caché se vuelve a pedir a Semantic Scholar al expirar esta ventana.",
  },

  // -- Settings: misc sliders ---------------------------------------------
  "settings.abstract.name": {
    en: "Abstract preview length",
    fr: "Longueur de l'aperçu du résumé",
    es: "Longitud del resumen previo",
  },
  "settings.abstract.desc": {
    en: "Characters of abstract shown in the hover card before truncating.",
    fr: "Nombre de caractères du résumé affichés dans la carte de survol avant troncature.",
    es: "Caracteres del resumen mostrados en la tarjeta emergente antes de truncar.",
  },
  "settings.hoverDelay.name": {
    en: "Hover delay (ms)",
    fr: "Délai d'affichage au survol (ms)",
    es: "Retraso al pasar el cursor (ms)",
  },
  "settings.hoverDelay.desc": {
    en: "How long to wait before popping the citation hover card.",
    fr: "Délai avant d'afficher la carte de survol d'une citation.",
    es: "Tiempo de espera antes de mostrar la tarjeta emergente de una cita.",
  },
  "settings.cacheTtl.name": {
    en: "Cache TTL (minutes)",
    fr: "Durée de vie du cache (minutes)",
    es: "TTL del caché (minutos)",
  },
  "settings.cacheTtl.desc": {
    en: "How long hydrated items live before re-fetching from Zotero.",
    fr: "Durée pendant laquelle les éléments hydratés sont conservés avant d'être récupérés à nouveau depuis Zotero.",
    es: "Cuánto tiempo se conservan los ítems antes de volver a pedirlos a Zotero.",
  },

  // -- Panel (BibView) -----------------------------------------------------
  "view.displayText": {
    en: "Zoob references",
    fr: "Références zoob",
    es: "Referencias de zoob",
  },
  "view.title": {
    en: "References",
    fr: "Références",
    es: "Referencias",
  },
  "view.health.checking": {
    en: "Checking Zotero connection…",
    fr: "Vérification de la connexion à Zotero…",
    es: "Verificando la conexión con Zotero…",
  },
  "view.health.ok": {
    en: "Connected to Zotero",
    fr: "Connecté à Zotero",
    es: "Conectado con Zotero",
  },
  "view.health.bad": {
    en: "Zotero unreachable",
    fr: "Zotero inaccessible",
    es: "Zotero no disponible",
  },
  "view.health.badWithMsg": {
    en: "Zotero unreachable — ${message}",
    fr: "Zotero inaccessible — ${message}",
    es: "Zotero no disponible — ${message}",
  },
  "view.density.toDetailed": {
    en: "Switch to detailed view",
    fr: "Passer à la vue détaillée",
    es: "Cambiar a vista detallada",
  },
  "view.density.toCompact": {
    en: "Switch to compact view",
    fr: "Passer à la vue compacte",
    es: "Cambiar a vista compacta",
  },
  "view.sort.authorMode": {
    en: "Sort: by first author (A–Z). Click for cite order.",
    fr: "Tri : par premier auteur (A–Z). Cliquez pour l'ordre de citation.",
    es: "Orden: por primer autor (A–Z). Haz clic para el orden de cita.",
  },
  "view.sort.docMode": {
    en: "Sort: cite order in document. Click for A–Z by first author.",
    fr: "Tri : ordre de citation dans le document. Cliquez pour A–Z par premier auteur.",
    es: "Orden: orden de cita en el documento. Haz clic para A–Z por primer autor.",
  },
  "view.filter.aria": {
    en: "Filter",
    fr: "Filtrer",
    es: "Filtrar",
  },
  "view.filter.tooltip": {
    en: "Filter visible entries",
    fr: "Filtrer les entrées visibles",
    es: "Filtrar las entradas visibles",
  },
  "view.refresh.aria": {
    en: "Refresh",
    fr: "Actualiser",
    es: "Actualizar",
  },
  "view.refresh.tooltip": {
    en: "Refresh from Zotero",
    fr: "Actualiser depuis Zotero",
    es: "Actualizar desde Zotero",
  },
  "view.filter.placeholder": {
    en: "Filter references…",
    fr: "Filtrer les références…",
    es: "Filtrar referencias…",
  },
  "view.filter.clear": {
    en: "Clear filter",
    fr: "Effacer le filtre",
    es: "Borrar filtro",
  },
  "view.state.idle": {
    en: "Open a note to see its references here.",
    fr: "Ouvrez une note pour voir ses références ici.",
    es: "Abre una nota para ver aquí sus referencias.",
  },
  "view.state.empty": {
    en: "No citations in this note yet. Type `[@` to start.",
    fr: "Aucune citation dans cette note pour l'instant. Tapez `[@` pour commencer.",
    es: "Esta nota aún no tiene citas. Escribe `[@` para empezar.",
  },
  "view.state.loading_one": {
    en: "Loading ${count} citation from Zotero…",
    fr: "Chargement de ${count} citation depuis Zotero…",
    es: "Cargando ${count} cita desde Zotero…",
  },
  "view.state.loading_other": {
    en: "Loading ${count} citations from Zotero…",
    fr: "Chargement de ${count} citations depuis Zotero…",
    es: "Cargando ${count} citas desde Zotero…",
  },
  "view.error.bbtTitle": {
    en: "Zotero returned an error",
    fr: "Zotero a renvoyé une erreur",
    es: "Zotero devolvió un error",
  },
  "view.error.bbtHintPrefix": {
    en: "Check that the citekeys in this note exist in the library named by the ",
    fr: "Vérifiez que les citekeys de cette note existent dans la bibliothèque indiquée par le ",
    es: "Comprueba que las citekeys de esta nota existen en la biblioteca indicada por ",
  },
  "view.error.bbtHintSuffix": {
    en: " frontmatter.",
    fr: " dans l'en-tête YAML.",
    es: " en el frontmatter.",
  },
  "view.error.tryAgain": {
    en: "Try again",
    fr: "Réessayer",
    es: "Reintentar",
  },
  "view.error.offlineTitle": {
    en: "Couldn't reach Zotero",
    fr: "Impossible de joindre Zotero",
    es: "No se pudo contactar con Zotero",
  },
  "view.error.offlinePrefix": {
    en: "Make sure Zotero is running with the ",
    fr: "Assurez-vous que Zotero est lancé avec l'extension ",
    es: "Asegúrate de que Zotero esté en ejecución con la extensión ",
  },
  "view.error.offlineSuffix": {
    en: " extension.",
    fr: ".",
    es: " instalada.",
  },
  "view.error.openZotero": {
    en: "Open Zotero",
    fr: "Ouvrir Zotero",
    es: "Abrir Zotero",
  },
  "view.missing.title": {
    en: " Not found in Zotero (${count}) — check `bib:` frontmatter",
    fr: " Introuvable dans Zotero (${count}) — vérifiez le `bib:` de l'en-tête",
    es: " No encontrado en Zotero (${count}) — revisa `bib:` en el frontmatter",
  },
  "view.filter.empty": {
    en: "No references match “${query}”.",
    fr: "Aucune référence ne correspond à « ${query} ».",
    es: "Ninguna referencia coincide con «${query}».",
  },

  // -- Item card ----------------------------------------------------------
  "card.openFullText": {
    en: "Open full text",
    fr: "Ouvrir le texte intégral",
    es: "Abrir texto completo",
  },
  "card.openInZotero": {
    en: "Open in Zotero",
    fr: "Ouvrir dans Zotero",
    es: "Abrir en Zotero",
  },
  "card.citekey.tooltip": {
    en: "@${citekey} — click to copy [@${citekey}]",
    fr: "@${citekey} — cliquer pour copier [@${citekey}]",
    es: "@${citekey} — clic para copiar [@${citekey}]",
  },
  "card.citekey.ariaCopy": {
    en: "Copy [@${citekey}]",
    fr: "Copier [@${citekey}]",
    es: "Copiar [@${citekey}]",
  },
  "card.pdf.open": {
    en: "Open PDF",
    fr: "Ouvrir le PDF",
    es: "Abrir PDF",
  },
  "card.pdf.checking": {
    en: "Checking for PDF…",
    fr: "Recherche du PDF…",
    es: "Buscando PDF…",
  },
  "card.pdf.none": {
    en: "No PDF attachment",
    fr: "Aucun PDF joint",
    es: "Sin PDF adjunto",
  },
  "card.pdf.openAltHint": {
    en: "Open PDF (Alt-click: opposite target)",
    fr: "Ouvrir le PDF (Alt-clic : destination inverse)",
    es: "Abrir PDF (Alt-clic: destino opuesto)",
  },
  "card.insertAtCursor": {
    en: "Insert citation at cursor",
    fr: "Insérer la citation au curseur",
    es: "Insertar cita en el cursor",
  },
  "card.citekey.copyTitle": {
    en: "Click to copy citekey",
    fr: "Cliquer pour copier la citekey",
    es: "Haz clic para copiar la citekey",
  },
  "card.title.openInZotero": {
    en: "Click to open in Zotero",
    fr: "Cliquer pour ouvrir dans Zotero",
    es: "Haz clic para abrir en Zotero",
  },
  "card.untitled": {
    en: "(untitled)",
    fr: "(sans titre)",
    es: "(sin título)",
  },
  "card.aiSummary": {
    en: "AI summary",
    fr: "Résumé IA",
    es: "Resumen IA",
  },
  "card.abstract.more": {
    en: "show more",
    fr: "voir plus",
    es: "mostrar más",
  },
  "card.abstract.less": {
    en: "show less",
    fr: "voir moins",
    es: "mostrar menos",
  },
  "card.notes_one": {
    en: "${count} note",
    fr: "${count} note",
    es: "${count} nota",
  },
  "card.notes_other": {
    en: "${count} notes",
    fr: "${count} notes",
    es: "${count} notas",
  },
  "card.copyFormatted": {
    en: "Copy formatted entry",
    fr: "Copier l'entrée formatée",
    es: "Copiar entrada formateada",
  },
  "card.zoteroBadge": {
    en: "Zotero",
    fr: "Zotero",
    es: "Zotero",
  },
  "card.attachment.pdf": {
    en: "PDF",
    fr: "PDF",
    es: "PDF",
  },
  "card.attachment.snapshot": {
    en: "Snapshot",
    fr: "Capture",
    es: "Instantánea",
  },
  "card.attachment.link": {
    en: "Link",
    fr: "Lien",
    es: "Enlace",
  },
  "card.attachment.generic": {
    en: "Attachment",
    fr: "Pièce jointe",
    es: "Adjunto",
  },
  "card.s2.na": {
    en: "Cited by: ?",
    fr: "Cité par : ?",
    es: "Citado por: ?",
  },
  "card.s2.noLookup": {
    en: "No DOI or title available",
    fr: "Pas de DOI ni de titre disponibles",
    es: "Sin DOI ni título disponibles",
  },
  "card.s2.checking": {
    en: "Checking Semantic Scholar…",
    fr: "Interrogation de Semantic Scholar…",
    es: "Consultando Semantic Scholar…",
  },
  "card.s2.notFound": {
    en: "Not found (click to retry — often a rate-limit blip)",
    fr: "Introuvable (cliquer pour réessayer — souvent une limite de débit temporaire)",
    es: "No encontrado (clic para reintentar — suele ser un límite de frecuencia puntual)",
  },
  "card.s2.citedBy": {
    en: "Cited by ${count}",
    fr: "Cité par ${count}",
    es: "Citado por ${count}",
  },
  "card.s2.openPage": {
    en: "Open on Semantic Scholar",
    fr: "Ouvrir sur Semantic Scholar",
    es: "Abrir en Semantic Scholar",
  },
  "card.annotations_one": {
    en: "${count} annotation — drag to insert as quote",
    fr: "${count} annotation — glisser pour l'insérer en citation",
    es: "${count} anotación — arrástrala para insertar como cita",
  },
  "card.annotations_other": {
    en: "${count} annotations — drag to insert as quote",
    fr: "${count} annotations — glisser pour les insérer en citation",
    es: "${count} anotaciones — arrástralas para insertar como cita",
  },

  // -- Suggester + refs block --------------------------------------------
  "suggest.searching": {
    en: "⏳  Searching Zotero for “${query}”…",
    fr: "⏳  Recherche Zotero de « ${query} »…",
    es: "⏳  Buscando «${query}» en Zotero…",
  },
  "suggest.empty": {
    en: "No results for “${query}”",
    fr: "Aucun résultat pour « ${query} »",
    es: "Sin resultados para «${query}»",
  },
  "suggest.untitled": {
    en: "(untitled)",
    fr: "(sans titre)",
    es: "(sin título)",
  },
  "refs.heading": {
    en: "References",
    fr: "Références",
    es: "Referencias",
  },
  "refs.loading": {
    en: "Loading references…",
    fr: "Chargement des références…",
    es: "Cargando referencias…",
  },
  "refs.empty": {
    en: "No citations found in this note.",
    fr: "Aucune citation trouvée dans cette note.",
    es: "No se encontraron citas en esta nota.",
  },
  "refs.headingCount": {
    en: "References (${count})",
    fr: "Références (${count})",
    es: "Referencias (${count})",
  },
  "refs.error": {
    en: "Couldn't format references: ${message}",
    fr: "Impossible de formater les références : ${message}",
    es: "No se pudieron formatear las referencias: ${message}",
  },

  // -- Hover-card inline errors ------------------------------------------
  "hover.error.reach": {
    en: "Couldn't reach Zotero: ${message}",
    fr: "Impossible de joindre Zotero : ${message}",
    es: "No se pudo contactar con Zotero: ${message}",
  },
  "hover.error.noItem": {
    en: "No Zotero item for @${citekey}",
    fr: "Aucun élément Zotero pour @${citekey}",
    es: "No hay ítem de Zotero para @${citekey}",
  },
} as const satisfies Record<string, Triple>;

export type StringKey = keyof typeof STRINGS;
