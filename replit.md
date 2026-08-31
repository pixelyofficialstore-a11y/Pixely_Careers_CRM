# PixelCRM (Pixely Careers)

## Overview

PixelCRM is an internal agency management platform for Pixely Careers, designed to streamline the management of orders for ATS CV, LinkedIn optimization, and Cover Letter services. It features role-based access control (Admin, Support, Designer), comprehensive order tracking with payment verification workflow, team management, and business analytics.

## Running on Replit

- Start the app from the **Start application** workflow, which runs `npm run dev` and serves the web preview on port 5000.
- The Vite development server is configured for Replit's proxied hosts and the Express/Vite app listens on `0.0.0.0:5000`.
- Dependencies are declared in `package.json` and locked in `pnpm-lock.yaml`; the workflow starts after the dependency install completes.
- The app requires a PostgreSQL connection through Replit's managed `DATABASE_URL` (or an optional `SUPABASE_DATABASE_URL` secret). Startup runs the existing database migrations and seed routine.
- `SESSION_SECRET` is required for session authentication.
- Cloudinary and Web Push (VAPID) credentials are optional; without them, uploads use database storage and background push notifications are disabled.

## User Preferences

Preferred communication style: Simple, everyday language.

## Recent Changes

- **Apr 17, 2026**: Added **Web Push (background) notifications** via VAPID / Web Push API. Server generates a VAPID key pair stored in `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` env vars. New `push_subscriptions` table stores per-user browser subscriptions. New routes: `GET /api/push/vapid-public-key`, `POST /api/push/subscribe`, `DELETE /api/push/unsubscribe`. All `storage.createNotification` calls in `server/routes.ts` were replaced with a `notifyUser` wrapper that also fires `sendWebPushToUser` — which delivers a web push payload to every stored subscription for that user via the `web-push` npm package. Stale subscriptions (HTTP 410/404) are automatically removed. Service worker updated with a `push` event handler to display native OS notifications even when the tab is closed. `NotificationBell.tsx` now calls `subscribeToWebPush()` on mount (and whenever permission changes) to register the browser with `PushManager.subscribe()` and save the subscription to the server.
- **Apr 16, 2026 (update 5)**: Three notification/badge improvements: (1) **Badge refresh speed** — Payments sidebar badge polls every 5 seconds (was 30s); NotificationBell unread count polls every 6 seconds (was 15s). (2) **Notification logic overhaul** — When any non-admin places an order, admins get "Payment request: {client}" notification (was "New order placed"); when admin **approves** a payment, all other admins (not the approver) get "Order approved: {client} — #{orderNumber}"; (3) **Admin orders auto-approved** — when an admin places an order, it is immediately set to `status: "new"`, `advancePaymentStatus: "approved"`, assigned to the intended designer, and given an order number — no screenshot upload required. Other admins (not the creating admin) get "New order: {client} — #{orderNumber}" notification. The placing admin gets no notification. Assigned designer gets "New order assigned: #{orderNumber}".
- **Apr 16, 2026 (update 4)**: Three improvements: (1) **Designer sees full order details** — order number now visible to all roles including designer in the detail sheet; platform/source field also shown to all roles. (2) **Unapproved orders hidden from Orders Page for everyone** — `visibleOrders` now always filters by `advancePaymentStatus === 'approved'` regardless of role (previously admin could see unapproved orders in Orders Page; now unapproved orders are exclusively reviewed in the Payments page). (3) **Mobile UX upgrade** — mobile padding reduced (`p-4 md:p-8`); both Today and Monthly tabs now show compact mobile card views on small screens (client name, order number, status badge, services, amounts, quick status select, Details button) and hide the wide data table; `NotificationBell` now appears in the mobile top navigation bar alongside the hamburger menu.
- **Apr 16, 2026 (update 3)**: Added **Real-Time Notification System**. New `NotificationBell` component in the sidebar header with: red animated badge showing live unread count (polled every 15s); dropdown panel listing recent notifications with type-colored icons (order/payment/assignment); mark-all-read and per-notification mark-read; **notification sound** (Web Audio API ding) plays when unread count increases; **browser push notifications** (native OS notification) shown when new notifications arrive and user has granted permission. New server routes: `GET /api/notifications/unread-count`, `PATCH /api/notifications/mark-all-read`. Admin now receives notifications when: (1) any order is placed — "New order placed by {clientName}"; (2) any payment verification request is made — "Payment verification request: {clientName} — {type} payment". Designer receives notification when assigned to an order (already existed). `storage.getAdmins()`, `getUnreadNotificationCount()`, `markAllNotificationsRead()` added to storage.
- **Apr 16, 2026 (update 2)**: Added **Marketing Platforms** system. New `platforms_catalog` DB table with 8 default platforms seeded (Facebook, Instagram, TikTok, Google Ads, Referral, Direct/Walk-in, WhatsApp, Other). Each platform has a `hasCampaignFields` flag — when enabled, the order form shows Campaign / Ad Set / Creative fields. Added `platform` column to `orders` table. Admin Settings now has a third **Platforms** tab (add/edit/rename/toggle active/toggle campaign fields/delete). Order creation form has a new "How did the client find us?" dropdown that conditionally reveals campaign tracking fields. Analytics Marketing tab now shows **Platform Breakdown** (platform → campaign → ad set → creative hierarchy) instead of a flat campaign list. "Best Platform" replaces "Best Campaign" in the summary stat cards. Marketing PDF export now includes platform table + campaign tracking table.
- **Apr 16, 2026**: Added Admin Settings page (`/admin-settings`) with two sections: (1) **Services Catalog** — admin can add, edit, rename, toggle active/inactive, and delete services that appear in the Custom Package order form; (2) **Packages** — admin can rename existing packages (Starter, Professional, Executive), toggle them active/inactive, and add new custom packages. Added `services_catalog` and `package_configs` database tables. OrdersPage now fetches services and packages dynamically from the API instead of using hardcoded arrays. The "Custom Order" type is always built-in and cannot be deleted.

- **Feb 20, 2026**: Added package selection to order creation form. Three package types (Starter, Professional, Executive) plus Custom Order option. When a package is selected, the services picker is hidden. Custom Order shows the existing services picker. Orders table displays package name badge for package orders or service count for custom orders. Package type stored in `packageType` column on `orders` table. Backend validates packageType and allows empty services for non-custom packages.
- **Feb 8, 2026**: Fixed payment workflow. Orders now created with `pending_payment` status and hidden from orders list until admin approves payment. Only after approval does the order get an order number, change to `new` status, and appear in the orders list. Added `pending_payment` to `orderStatuses` enum. Storage `getOrders` excludes `pending_payment` orders. Object storage upload also made resilient to missing env vars.
- **Feb 8, 2026**: Added Support Performance tab in Analytics page. Admin can track orders placed by each support agent with day/month/year date filtering. Shows monthly summary, revenue breakdown (total/collected/pending), order status breakdown, and daily order details. PDF export available.
- **Feb 8, 2026**: Verified payment screenshots already use cloud object storage (Replit Object Storage) for new uploads. Local storage only used as fallback for legacy files.
- **Feb 8, 2026**: Implemented enhanced support agent restrictions. Added `support_designer_assignments` junction table so admins can assign specific designers to each support agent. Support agents now only see orders they created (filtered by `createdById`). Support agents can only assign orders to their designated designers (enforced on both frontend and backend). TeamPage updated with designer assignment UI. DashboardPage and OrdersPage filtered for support agent scope.
- **Feb 8, 2026**: Connected app to Supabase PostgreSQL database. Updated db.ts to prefer SUPABASE_DATABASE_URL with SSL support. Synced schema to Supabase and cleaned up removed tables.
- **Feb 8, 2026**: Removed all WhatsApp, chat messaging, shortcuts, and catalog features as requested. Dropped chats, messages, message_shortcuts tables from database. Cleaned up all related API routes, storage methods, schemas, page files, CSS variables, and seed data.

## System Architecture

### Core Architecture
The application uses a monorepo structure with a React 18 frontend (TypeScript, Wouter, TanStack React Query, shadcn/ui, Tailwind CSS) and an Express 5 backend (Node.js, Passport.js for authentication, scrypt for password hashing). Data is stored in a PostgreSQL database managed by Drizzle ORM.

### Role-Based Access Control
Three distinct roles are implemented:
- **Admin**: Full access including finance, user management, analytics, and all orders. Can assign specific designers to each support agent via the Team page.
- **Support**: Can only see/manage orders they created (filtered by `createdById`). Can only assign orders to designers specifically assigned to them by admin. Cannot see financial amounts. Uses `support_designer_assignments` junction table for designer restrictions.
- **Designer**: Limited to viewing and updating assigned orders' delivery status.

### Frontend
- **UI/UX**: Modern design using shadcn/ui components with a dark theme (slate-based with blue accents). Features a responsive design and mobile navigation.
- **Pages**: Dashboard, Orders, Payments, Team (admin), Analytics (admin), Auth/Login.

### Backend
- **API**: RESTful endpoints with Zod validation.
- **Authentication**: Session-based authentication with extended session timeout (1 year).

### Data Management
- **Database**: PostgreSQL, with Drizzle ORM for schema definition and migrations.
- **Key Data Models**: Users, Orders, Order Services, Notifications, Payment Verifications, Activity Logs, Monthly Finance.
- **Financial Data**: All monetary values are stored as integers (PKR paisa) and displayed in PKR (₨), with an `advanceAmount` and `remainingAmount` split.
- **Order Flow**: Supports multi-service orders, role-based order visibility, and a comprehensive payment verification workflow. Orders are only considered active and financially relevant upon payment approval. Order numbers are generated only after admin payment approval.
- **File Storage**: New uploads use Replit Object Storage (cloud-based) which persists across development and production. Legacy files stored locally in `/uploads/` folder only work in development. Object storage module located at `server/replit_integrations/object_storage/`.

### Features
- **Order Management**: Creation, editing, assignment, status tracking (New, Working, Ready, Delivered, Canceled).
- **Team Management**: Admin-only user creation and editing.
- **Payment Verification**: Dedicated workflow for approving/disapproving advance, full, and remaining payments with screenshot uploads. Admin has full control, while Support/Designer can submit requests.
- **Analytics & Reporting**: Admin-only dashboard with designer performance tracking and marketing analytics. PDF export functionality is available for reports.
- **Dashboard**: Role-specific dashboards showing order stats, financial summary (admin), and designer performance.

## Project Structure

```
client/src/
  pages/         - AuthPage, DashboardPage, OrdersPage, PaymentsPage, TeamPage, AnalyticsPage
  components/    - Sidebar, Layout, shadcn UI components
  hooks/         - use-auth, use-toast
  lib/           - queryClient, utils
server/
  routes.ts      - API route handlers
  storage.ts     - Database storage interface
  seed.ts        - Production seed data
  db.ts          - Database connection
  replit_integrations/ - Object storage integration
shared/
  schema.ts      - Drizzle ORM schema definitions and types
  routes.ts      - API route type definitions
```

## External Dependencies

- **PostgreSQL**: Supabase-hosted PostgreSQL database (via SUPABASE_DATABASE_URL secret). Falls back to Replit's built-in DATABASE_URL if Supabase URL is not set.
- **Drizzle ORM**: For database schema definition and migrations.
- **Radix UI**: Accessible UI primitives for components.
- **Tailwind CSS**: For styling.
- **TanStack React Query**: For server state management.
- **Wouter**: Lightweight React router.
- **Passport.js**: For authentication.
- **date-fns**: For date manipulation.
- **jsPDF with autoTable plugin**: For PDF report generation.
- **Multer**: For handling file uploads.
- **web-push**: For sending Web Push (background) notifications via VAPID to subscribed browsers.
