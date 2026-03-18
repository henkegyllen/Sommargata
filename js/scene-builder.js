/**
 * scene-builder.js
 * Tar emot config och bygger upp A-Frame-markörer och innehållsentiteter dynamiskt.
 * Stödjer tre innehållstyper: model (GLB), photo (billboard), infoPanel (3D-textruta).
 *
 * Om en GLB-fil saknas visas en blå roterande kub som platshållare.
 * Om en bildfil saknas visas en grå rektangel som platshållare.
 */
(function () {

  /**
   * Skapar en 3D-modellentitet.
   * Om src-filen inte finns eller inte är angiven används en platshållarkub.
   */
  function buildModel(item, assetId, assets) {
    const hasSrc = item.src && item.src.trim() !== '';
    let entity;

    if (hasSrc) {
      const assetItem = document.createElement('a-asset-item');
      assetItem.setAttribute('id', assetId);
      assetItem.setAttribute('src', item.src);
      assets.appendChild(assetItem);

      entity = document.createElement('a-gltf-model');
      entity.setAttribute('src', '#' + assetId);
    } else {
      // Platshållarkub
      entity = document.createElement('a-box');
      entity.setAttribute('color', '#4a90d9');
      entity.setAttribute('opacity', '0.85');
      entity.setAttribute('metalness', '0.3');
      entity.setAttribute('roughness', '0.5');
    }

    entity.setAttribute('position', item.position || '0 0.05 0');
    entity.setAttribute('scale', item.scale || '0.3 0.3 0.3');
    if (item.rotation) entity.setAttribute('rotation', item.rotation);

    // Lägg till roteringsanimation
    entity.setAttribute('animation', 'property: rotation; to: 0 360 0; loop: true; dur: 8000; easing: linear');

    return entity;
  }

  /**
   * Skapar en bild-billboard.
   * Lägg till ett valfritt label-attribut i config för en bildtext ovanför bilden.
   */
  function buildPhoto(item, assetId, assets) {
    const hasSrc = item.src && item.src.trim() !== '';

    if (hasSrc) {
      const img = document.createElement('img');
      img.setAttribute('id', assetId);
      img.setAttribute('src', item.src);
      img.setAttribute('crossorigin', 'anonymous');
      assets.appendChild(img);
    }

    const wrap = document.createElement('a-entity');
    wrap.setAttribute('position', item.position || '0 0.1 0');
    if (item.rotation) wrap.setAttribute('rotation', item.rotation);

    const billboard = document.createElement('a-image');
    if (hasSrc) {
      billboard.setAttribute('src', '#' + assetId);
    } else {
      billboard.setAttribute('color', '#555577');
    }
    billboard.setAttribute('scale', item.scale || '0.2 0.15 1');
    wrap.appendChild(billboard);

    // Valfri bildtext
    if (item.label) {
      const scaleY = parseFloat((item.scale || '0.2 0.15 1').split(' ')[1]);
      const lbl = document.createElement('a-text');
      lbl.setAttribute('value', item.label);
      lbl.setAttribute('align', 'center');
      lbl.setAttribute('color', '#ffffff');
      lbl.setAttribute('position', '0 ' + (scaleY / 2 + 0.025) + ' 0.001');
      lbl.setAttribute('width', '0.35');
      lbl.setAttribute('wrap-count', '22');
      wrap.appendChild(lbl);
    }

    return wrap;
  }

  /**
   * Skapar en informationsruta med titel och brödtext.
   * Panelen är ett halvtransparent mörkblått plan med vit text.
   */
  function buildInfoPanel(item) {
    const wrap = document.createElement('a-entity');
    wrap.setAttribute('position', item.position || '0 0.15 0');
    if (item.rotation) wrap.setAttribute('rotation', item.rotation);

    // Bakgrundsplan
    const bg = document.createElement('a-plane');
    bg.setAttribute('color', '#1a1a2e');
    bg.setAttribute('opacity', '0.9');
    bg.setAttribute('width', '0.5');
    bg.setAttribute('height', '0.2');
    bg.setAttribute('side', 'double');
    wrap.appendChild(bg);

    // Titel
    if (item.title) {
      const t = document.createElement('a-text');
      t.setAttribute('value', item.title);
      t.setAttribute('align', 'center');
      t.setAttribute('color', '#ffffff');
      t.setAttribute('position', '0 0.065 0.001');
      t.setAttribute('width', '0.45');
      t.setAttribute('wrap-count', '22');
      wrap.appendChild(t);
    }

    // Brödtext
    if (item.body) {
      const b = document.createElement('a-text');
      b.setAttribute('value', item.body);
      b.setAttribute('align', 'center');
      b.setAttribute('color', '#ccccdd');
      b.setAttribute('position', '0 -0.012 0.001');
      b.setAttribute('width', '0.43');
      b.setAttribute('wrap-count', '40');
      wrap.appendChild(b);
    }

    return wrap;
  }

  /**
   * Lyssnar på att config.json laddats och bygger sedan upp hela AR-scenen.
   */
  document.addEventListener('ar-config-loaded', function (e) {
    const config = e.detail;
    const scene = document.getElementById('ar-scene');
    const assets = document.getElementById('asset-manager');

    config.stations.forEach(function (station) {

      // Skapa markörselement
      const marker = document.createElement('a-marker');

      if (station.marker.type === 'preset') {
        marker.setAttribute('preset', station.marker.preset);
      } else if (station.marker.type === 'barcode') {
        marker.setAttribute('type', 'barcode');
        marker.setAttribute('value', String(station.marker.value));
      } else if (station.marker.type === 'pattern') {
        marker.setAttribute('type', 'pattern');
        marker.setAttribute('url', station.marker.url);
      }

      marker.setAttribute('id', station.id);
      // Mjuknar ut rörelsejitter vid detektering
      marker.setAttribute('smooth', 'true');
      marker.setAttribute('smoothCount', '5');
      marker.setAttribute('smoothTolerance', '0.01');
      marker.setAttribute('smoothThreshold', '2');

      // Bygg innehållsentiteter
      station.content.forEach(function (item, idx) {
        const assetId = station.id + '-asset-' + idx;
        let el;

        if (item.type === 'model') {
          el = buildModel(item, assetId, assets);
        } else if (item.type === 'photo') {
          el = buildPhoto(item, assetId, assets);
        } else if (item.type === 'infoPanel') {
          el = buildInfoPanel(item);
        }

        if (el) marker.appendChild(el);
      });

      scene.appendChild(marker);
    });

    // Initiera markörhändelsehanteraren efter att DOM-elementen skapats
    requestAnimationFrame(function () {
      MarkerManager.init(config.stations);
    });
  });

  // Vidarebefordra config-fel till UI
  document.addEventListener('ar-config-error', function (e) {
    UIController.showError('Kunde inte ladda innehåll:\n' + e.detail);
  });

})();
