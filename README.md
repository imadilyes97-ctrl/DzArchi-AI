# 🏗️ DzArchi AI — Architecture Intelligence

Transformez vos plans 2D en perspectives 3D photoréalistes via l'IA générative.

## ✨ Fonctionnalités

- **Drag & drop** — Téléversez un plan 2D (PNG/JPG, max 10 Mo)
- **Styles architecturaux** — Moderne, Scandinave, Méditerranéen, Industriel
- **IA générative** — Propulsé par Hugging Face Spaces (Stable Diffusion, FLUX, etc.)
- **Fallback automatique** — 3 Spaces de secours en cas d'indisponibilité
- **Téléchargement HD** — Avec fallback CORS automatique
- **Bilingue** — Français / العربية
- **Design premium** — Dark mode, glassmorphism, animations fluides

## 🚀 Utilisation

1. Ouvrez `index.html` dans un navigateur moderne (Chrome, Firefox, Edge)
2. Glissez-déposez ou cliquez pour téléverser un plan 2D
3. Choisissez le type de projet et le style architectural
4. Personnalisez le prompt (optionnel)
5. Cliquez sur **Générer le rendu 3D**

## 🔧 Configuration avancée

### 🤗 Token Hugging Face (RECOMMANDÉ)

L'API Inference Hugging Face est **beaucoup plus fiable** que les Spaces Gradio gratuits :
- ✅ Pas de mise en veille (cold start géré automatiquement)
- ✅ Réponse en 10-30s au lieu de 1-3 min
- ✅ Fallback automatique entre modèles

1. Créez un token gratuit sur [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens)
2. Copiez-le dans le champ **🔑 Token Hugging Face** dans l'interface
3. Les générations passeront par l'API Inference (prioritaire)

_Sans token, le système utilise les Spaces Gradio en fallback (plus lent, cold start 1-3 min)._

### Space ID personnalisé

Vous pouvez utiliser votre propre Space Hugging Face en modifiant le champ **Space ID** dans l'interface.

**Spaces par défaut (fallback Gradio) :**
- `stabilityai/stable-diffusion-2-1`
- `stabilityai/stable-diffusion-xl-base-1.0`
- `runwayml/stable-diffusion-v1-5`
- `black-forest-labs/FLUX.1-schnell`

### Cloudflare Worker (proxy HF — OBLIGATOIRE pour Algérie)

⚠️ **L'API `api-inference.huggingface.co` est bloquée dans certains pays (Algérie).**
Il faut déployer un Cloudflare Worker qui sert de proxy.

**Option 1 : Cloudflare Dashboard (recommandé, 5 clics)**
1. Allez sur [Cloudflare Dashboard](https://dash.cloudflare.com) → Workers & Pages
2. Cliquez sur **Créer un Worker**
3. Supprimez le code par défaut et collez le contenu de `worker/index.js`
4. Cliquez sur **Déployer**
5. Copiez l'URL (ex: `https://dzarchi-hf-proxy.nom.workers.dev`)
6. Collez cette URL dans le champ **☁️ Cloudflare Worker URL** dans l'application

**Option 2 : CLI (si wrangler fonctionne)**
```bash
cd worker
npm install -g wrangler
wrangler deploy
```

**Après déploiement :** mettez votre token HF + l'URL du worker dans l'app → img2img fonctionne avec votre plan 2D !

## 🛠 Stack

- HTML5 · Tailwind CSS v3 (CDN)
- Lucide Icons · Google Fonts
- @gradio/client · Hugging Face Spaces
- Zero dépendance serveur — 100% client-side

## 📝 Notes

- Les temps de génération dépendent de la disponibilité des Spaces gratuits Hugging Face
- Un Space en veille peut mettre 30-90s à répondre
- En cas d'échec, le système tente automatiquement les Spaces de secours

---

Construit par **JARVIS** pour Ilyes — juillet 2026
