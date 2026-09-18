(function () {
  "use strict";

  const REFTABLE_URL = "referentietabel.json";
  const RED_FILL = { fill: { fgColor: { rgb: "FFFF0000" }, patternType: "solid" } };

  let refData = {};
  let refMeta = null;
  let lastWorkbook = null;
  let lastFilename = "";

  // ---------- Tabs ----------
  const tabButtons = document.querySelectorAll(".tab-btn");
  const panels = { verwerken: document.getElementById("panel-verwerken"), beheren: document.getElementById("panel-beheren") };
  tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      tabButtons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      Object.values(panels).forEach((p) => p.classList.add("hidden"));
      panels[btn.dataset.tab].classList.remove("hidden");
    });
  });

  // ---------- Referentietabel laden ----------
  async function loadReferentietabel() {
    const metaLines = document.querySelectorAll(".ref-meta");
    try {
      const resp = await fetch(REFTABLE_URL + "?t=" + Date.now(), { cache: "no-store" });
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      const json = await resp.json();
      refData = json.data || {};
      refMeta = json.meta || null;
      const aantal = refMeta ? refMeta.aantal : Object.keys(refData).length;
      const datum = refMeta ? refMeta.gegenereerd : "onbekend";
      metaLines.forEach((el) => {
        el.textContent = `Referentietabel geladen: ${aantal.toLocaleString("nl-NL")} koppelingen, bijgewerkt op ${datum}.`;
      });
      document.getElementById("verwerkBtn").disabled = false;
    } catch (e) {
      metaLines.forEach((el) => {
        el.textContent = "Kon de referentietabel niet laden (" + e.message + "). Verversen en opnieuw proberen.";
        el.classList.add("error-text");
      });
    }
  }
  loadReferentietabel();

  // ---------- Normalisatie / lookup met fallback ----------
  function stripLeadingZeros(s) {
    const n = s.replace(/^0+(?=\d)/, "");
    return n === "" ? "0" : n;
  }
  function lookupDcNummer(nrRaw) {
    const nr = String(nrRaw).trim();
    if (nr in refData) return refData[nr];
    const stripped = stripLeadingZeros(nr);
    for (const key in refData) {
      if (stripLeadingZeros(key) === stripped) return refData[key];
    }
    return null;
  }

  // ---------- Dropzone helper ----------
  function setupDropzone(zoneId, inputId, onFile) {
    const zone = document.getElementById(zoneId);
    const input = document.getElementById(inputId);
    zone.addEventListener("click", () => input.click());
    input.addEventListener("change", () => {
      if (input.files[0]) onFile(input.files[0]);
    });
    ["dragenter", "dragover"].forEach((ev) =>
      zone.addEventListener(ev, (e) => {
        e.preventDefault();
        zone.classList.add("drag");
      })
    );
    ["dragleave", "drop"].forEach((ev) =>
      zone.addEventListener(ev, (e) => {
        e.preventDefault();
        zone.classList.remove("drag");
      })
    );
    zone.addEventListener("drop", (e) => {
      const file = e.dataTransfer.files[0];
      if (file) onFile(file);
    });
  }

  // ---------- GitHub-koppeling ----------
  const LS_REPO = "gh_repo";
  const LS_TOKEN = "gh_token";

  function getGithubConfig() {
    const repo = localStorage.getItem(LS_REPO) || "";
    const token = localStorage.getItem(LS_TOKEN) || "";
    return repo && token ? { repo, token } : null;
  }

  function updateGithubStatusLine() {
    const el = document.getElementById("githubStatusLine");
    const cfg = getGithubConfig();
    const btn = document.getElementById("converteerBtn");
    const editForm = document.getElementById("githubEditForm");
    const wijzigBtn = document.getElementById("githubWijzigBtn");
    if (cfg) {
      el.textContent = `Gekoppeld aan repository ${cfg.repo}. Publiceren gaat automatisch.`;
      document.getElementById("githubRepoInput").value = cfg.repo;
      if (btn) btn.textContent = "Converteren en publiceren";
      editForm.classList.add("hidden");
      wijzigBtn.style.display = "inline-block";
    } else {
      el.textContent = "Niet gekoppeld — bewaar hieronder een repository + sleutel om automatisch te publiceren.";
      if (btn) btn.textContent = "Converteren en uploaden";
      editForm.classList.remove("hidden");
      wijzigBtn.style.display = "none";
    }
  }

  document.getElementById("githubWijzigBtn").addEventListener("click", () => {
    document.getElementById("githubEditForm").classList.remove("hidden");
    document.getElementById("githubWijzigBtn").style.display = "none";
  });

  document.getElementById("githubSaveBtn").addEventListener("click", () => {
    const repo = document.getElementById("githubRepoInput").value.trim();
    const token = document.getElementById("githubTokenInput").value.trim();
    const statusEl = document.getElementById("githubStatus");
    statusEl.className = "status";
    if (!repo || !token || repo.indexOf("/") === -1) {
      statusEl.textContent = "Vul zowel repository (eigenaar/naam) als sleutel in.";
      statusEl.classList.add("error");
      return;
    }
    localStorage.setItem(LS_REPO, repo);
    localStorage.setItem(LS_TOKEN, token);
    document.getElementById("githubTokenInput").value = "";
    statusEl.textContent = "Koppeling opgeslagen.";
    statusEl.classList.add("ok");
    updateGithubStatusLine();
  });

  document.getElementById("githubClearBtn").addEventListener("click", () => {
    localStorage.removeItem(LS_REPO);
    localStorage.removeItem(LS_TOKEN);
    document.getElementById("githubRepoInput").value = "";
    document.getElementById("githubTokenInput").value = "";
    document.getElementById("githubStatus").textContent = "Koppeling verwijderd.";
    document.getElementById("githubStatus").className = "status ok";
    updateGithubStatusLine();
  });

  function utf8ToBase64(str) {
    return btoa(unescape(encodeURIComponent(str)));
  }

  async function publishReferentietabel(jsonString) {
    const cfg = getGithubConfig();
    if (!cfg) throw new Error("Geen GitHub-koppeling ingesteld.");
    const apiUrl = `https://api.github.com/repos/${cfg.repo}/contents/referentietabel.json`;
    const headers = {
      Authorization: "Bearer " + cfg.token,
      Accept: "application/vnd.github+json",
    };

    let sha;
    const getResp = await fetch(apiUrl, { headers });
    if (getResp.ok) {
      const data = await getResp.json();
      sha = data.sha;
    } else if (getResp.status !== 404) {
      const err = await getResp.json().catch(() => ({}));
      throw new Error("Kon huidig bestand niet ophalen: " + (err.message || getResp.status));
    }

    const body = {
      message: "Referentietabel bijgewerkt via inkooporder-app",
      content: utf8ToBase64(jsonString),
    };
    if (sha) body.sha = sha;

    const putResp = await fetch(apiUrl, {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!putResp.ok) {
      const err = await putResp.json().catch(() => ({}));
      throw new Error("Publiceren mislukt: " + (err.message || putResp.status));
    }
  }

  updateGithubStatusLine();

  function findHeaderCol(headerRow, names) {
    for (let i = 0; i < headerRow.length; i++) {
      const h = String(headerRow[i] || "").trim().toLowerCase();
      if (names.some((n) => n.toLowerCase() === h)) return i;
    }
    return -1;
  }

  // ================= Inkooporder verwerken =================
  let orderFile = null;
  setupDropzone("orderZone", "orderInput", (file) => {
    orderFile = file;
    document.getElementById("orderFilename").textContent = file.name;
    document.getElementById("verwerkResultaat").classList.add("hidden");
  });

  document.getElementById("verwerkBtn").addEventListener("click", async () => {
    const statusEl = document.getElementById("verwerkStatus");
    statusEl.textContent = "";
    statusEl.className = "status";
    if (!orderFile) {
      statusEl.textContent = "Kies eerst een inkooporder-bestand.";
      statusEl.classList.add("error");
      return;
    }
    try {
      const buf = await orderFile.arrayBuffer();
      const wbIn = XLSX.read(buf, { type: "array" });
      const sheetName = wbIn.SheetNames.includes("Regels") ? "Regels" : wbIn.SheetNames[0];
      const wsIn = wbIn.Sheets[sheetName];
      const aoa = XLSX.utils.sheet_to_json(wsIn, { header: 1, raw: false, defval: "" });

      if (!aoa.length) throw new Error("Het bestand lijkt leeg.");
      const header = aoa[0];
      const colType = findHeaderCol(header, ["Type"]);
      const colNr = findHeaderCol(header, ["Nr."]);
      const colLev = findHeaderCol(header, ["Artikelnr. leverancier"]);
      const colOms = findHeaderCol(header, ["Omschrijving"]);
      const colAantal = findHeaderCol(header, ["Aantal"]);
      const colEenheidCode = findHeaderCol(header, ["Code van eenheid"]);
      const colAantalInEenheid = findHeaderCol(header, ["Aantal in eenheid"]);
      const colBasiseenheid = findHeaderCol(header, ["Basiseenheid"]);
      if (colType === -1 || colNr === -1) {
        throw new Error("Verwachte kolommen (Type / Nr.) niet gevonden in dit bestand.");
      }

      const getNum = (row, col) => {
        if (col === -1) return 0;
        const n = parseFloat(String(row[col] || "0").replace(",", "."));
        return isNaN(n) ? 0 : n;
      };
      const getStr = (row, col) => (col === -1 ? "" : row[col]);

      let totaalArtikelen = 0;
      let gevonden = 0;
      const mismatches = [];

      const outHeader = [
        "Type",
        "Artikelnr. InstallatieBalie.nl",
        "Artikelnr. Oosterberg",
        "Artikelnr. leverancier",
        "Omschrijving",
        "Aantal",
        "Code van eenheid",
        "Aantal in eenheid",
        "Basiseenheid",
        "Totaal aantal in basiseenheid",
      ];
      const outRows = [outHeader];
      const nietGevondenRowIdx = [];

      for (let r = 1; r < aoa.length; r++) {
        const row = aoa[r];
        const type = String(row[colType] || "").trim();
        const nrRaw = row[colNr];
        const aantal = getNum(row, colAantal);
        const aantalInEenheid = getNum(row, colAantalInEenheid);
        let dcNr = "";

        if (type === "Artikel") {
          totaalArtikelen++;
          dcNr = lookupDcNummer(nrRaw) || "";
          if (dcNr) {
            gevonden++;
          } else {
            mismatches.push({ rij: r + 1, nr: nrRaw, omschrijving: getStr(row, colOms) });
            nietGevondenRowIdx.push(outRows.length);
          }
        }

        outRows.push([
          type,
          type === "Artikel" ? nrRaw : "",
          dcNr,
          getStr(row, colLev),
          getStr(row, colOms),
          aantal,
          getStr(row, colEenheidCode),
          aantalInEenheid,
          getStr(row, colBasiseenheid),
          aantal * aantalInEenheid,
        ]);
      }

      const wsOut = XLSX.utils.aoa_to_sheet(outRows);
      nietGevondenRowIdx.forEach((r) => {
        const addr = XLSX.utils.encode_cell({ r, c: 2 });
        wsOut[addr] = { t: "s", v: "", s: RED_FILL };
      });
      wsOut["!cols"] = outHeader.map((_, c) => {
        const maxLen = outRows.reduce((max, row) => Math.max(max, String(row[c] ?? "").length), 0);
        return { wch: maxLen + 2 };
      });
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, wsOut, "Regels");

      lastWorkbook = wb;
      lastFilename = orderFile.name.replace(/\.xlsx$/i, "") + "_Oosterberg.xlsx";

      document.getElementById("statTotaal").textContent = totaalArtikelen;
      document.getElementById("statGevonden").textContent = gevonden;
      document.getElementById("statNietGevonden").textContent = mismatches.length;

      const mismatchWrap = document.getElementById("mismatchWrap");
      const mismatchBody = document.getElementById("mismatchBody");
      mismatchBody.innerHTML = "";
      if (mismatches.length) {
        mismatches.forEach((m) => {
          const tr = document.createElement("tr");
          tr.innerHTML = `<td>${m.rij}</td><td>${m.nr}</td><td>${m.omschrijving}</td>`;
          mismatchBody.appendChild(tr);
        });
        mismatchWrap.classList.remove("hidden");
      } else {
        mismatchWrap.classList.add("hidden");
      }

      document.getElementById("verwerkResultaat").classList.remove("hidden");
      statusEl.textContent = "Klaar. Controleer de rood gemarkeerde regels hieronder voordat je verstuurt.";
      statusEl.classList.add(mismatches.length ? "error" : "ok");
    } catch (e) {
      statusEl.textContent = "Fout bij verwerken: " + e.message;
      statusEl.classList.add("error");
    }
  });

  document.getElementById("downloadBtn").addEventListener("click", () => {
    if (!lastWorkbook) return;
    XLSX.writeFile(lastWorkbook, lastFilename, { cellStyles: true });
  });

  // ================= Referentietabel beheren =================
  let refUploadFile = null;
  setupDropzone("refZone", "refInput", (file) => {
    refUploadFile = file;
    document.getElementById("refFilename").textContent = file.name;
    document.getElementById("refResultaat").classList.add("hidden");
  });

  document.getElementById("converteerBtn").addEventListener("click", async () => {
    const statusEl = document.getElementById("refStatus");
    statusEl.textContent = "";
    statusEl.className = "status";
    if (!refUploadFile) {
      statusEl.textContent = "Kies eerst het ruwe artikelreferentie-exportbestand.";
      statusEl.classList.add("error");
      return;
    }
    try {
      const buf = await refUploadFile.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheetName = wb.SheetNames.includes("Artikelreferentie") ? "Artikelreferentie" : wb.SheetNames[0];
      const ws = wb.Sheets[sheetName];
      const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });

      let headerRowIdx = -1;
      let colIb = -1;
      let colDc = -1;
      for (let r = 0; r < Math.min(aoa.length, 10); r++) {
        const c1 = findHeaderCol(aoa[r], ["Artikelnr."]);
        const c2 = findHeaderCol(aoa[r], ["Verwijzingsnr."]);
        if (c1 !== -1 && c2 !== -1) {
          headerRowIdx = r;
          colIb = c1;
          colDc = c2;
          break;
        }
      }
      if (headerRowIdx === -1) {
        throw new Error("Kolommen 'Artikelnr.' en 'Verwijzingsnr.' niet gevonden in dit bestand.");
      }

      const mapping = {};
      for (let r = headerRowIdx + 1; r < aoa.length; r++) {
        const row = aoa[r];
        const ib = String(row[colIb] || "").trim();
        const dc = String(row[colDc] || "").trim();
        if (ib && dc) mapping[ib] = dc;
      }

      const aantal = Object.keys(mapping).length;
      if (!aantal) throw new Error("Geen geldige koppelingen gevonden in dit bestand.");

      const out = {
        meta: { aantal: aantal, gegenereerd: new Date().toISOString().slice(0, 10) },
        data: mapping,
      };
      const jsonString = JSON.stringify(out);

      document.getElementById("refAantal").textContent = aantal.toLocaleString("nl-NL");
      document.getElementById("refResultaat").classList.remove("hidden");

      if (getGithubConfig()) {
        statusEl.textContent = "Bezig met publiceren…";
        await publishReferentietabel(jsonString);
        statusEl.textContent = "Gepubliceerd! Collega's gebruiken de nieuwe tabel automatisch (kan enkele minuten duren voordat de site is bijgewerkt).";
        statusEl.classList.add("ok");
      } else {
        const blob = new Blob([jsonString], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "referentietabel.json";
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        statusEl.textContent = "Nieuw referentietabel.json gedownload. Upload dit bestand nu via GitHub (Add file → Upload files) om het bestaande bestand te vervangen, of stel hierboven een GitHub-koppeling in om dit voortaan automatisch te laten gaan.";
        statusEl.classList.add("ok");
      }
    } catch (e) {
      statusEl.textContent = "Fout bij converteren: " + e.message;
      statusEl.classList.add("error");
    }
  });
})();
