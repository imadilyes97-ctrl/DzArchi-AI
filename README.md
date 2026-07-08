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

Vous pouvez utiliser votre propre Space Hugging Face en modifiant le champ **Space ID** dans l'interface.

**Spaces par défaut :**
- `stabilityai/stable-diffusion-3.5-large`
- `black-forest-labs/FLUX.1-schnell`
- `stabilityai/stable-diffusion-xl-base-1.0`

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
