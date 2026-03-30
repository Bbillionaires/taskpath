# TaskPath

Street sweeping route tracker — driver mobile PWA + supervisor dashboard + admin portal.

## Stack
- React 18 + Vite
- Supabase (auth, database, storage)
- Leaflet / react-leaflet (maps)
- Tailwind CSS
- vite-plugin-pwa (installable PWA)

## Setup

### 1. Create a Supabase project
1. Go to https://supabase.com and create a new project
2. In the SQL Editor, paste and run the contents of `schema.sql`
3. Go to Settings → API and copy your Project URL and anon key

### 2. Configure environment
```bash
cp .env.example .env
```
Edit `.env` and fill in your Supabase URL and anon key.

### 3. Install and run
```bash
npm install
npm run dev
```
Open http://localhost:5173

### 4. Create your first user
In Supabase dashboard → Authentication → Users → Add user.
Then in the SQL editor, update their profile role:
```sql
update profiles set role = 'admin' where auth_user_id = '<paste-user-uuid>';
```

### 5. Deploy to Vercel (enables real GPS on mobile)
```bash
npm install -g vercel
vercel
```
Add your `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as environment variables in the Vercel dashboard.

## Project Structure
```
src/
  lib/
    supabase.js       ← Supabase client singleton
    AuthContext.jsx   ← Auth state, role-based routing
  pages/
    LoginPage.jsx     ← Email/password login
    DriverApp.jsx     ← Driver mobile experience (GPS, map, job records)
    SupervisorApp.jsx ← Supervisor dashboard (placeholder — next to build)
    AdminApp.jsx      ← Admin portal (placeholder — next to build)
  components/
    LoadingScreen.jsx
  index.css
  main.jsx
  App.jsx             ← Role-based router (driver / supervisor / admin)
schema.sql            ← Full Supabase database schema with RLS policies
```

## What's wired up now
- Supabase auth (login, session persistence, sign out)
- Role-based routing (driver → DriverApp, supervisor → SupervisorApp, admin → AdminApp)
- Driver: loads today's assignment from Supabase
- Driver: auto-detects schedule variant based on day of week
- Driver: starts/pauses/completes jobs, saves records to Supabase
- Driver: real GPS tracking via browser Geolocation API (requires HTTPS)
- Driver: GPS track saved as GeoJSON LineString to job_records table

## What's next to build
1. Leaflet map wired to `assignment.routes.geojson` — render the route on satellite tiles
2. Coverage % calculation from GPS track vs route polyline
3. Supervisor dashboard — view driver status, completed jobs, route coverage maps
4. Admin portal — route upload, schedule variant config, driver assignment
5. Route PDF upload + color extraction pipeline
