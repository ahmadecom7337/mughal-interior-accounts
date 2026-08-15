# Mughal Interior Accounts — deployment

This folder contains the GitHub Pages frontend and Supabase migrations for customers, project quotations, invoices, inventory, suppliers, material purchase bills, walk-in orders, cash/bank payments, and business reports.

## Part A — Create the Supabase backend

1. Open the existing Supabase project **Carpenter Acc App**.
2. For a fresh database, run the SQL files in this order:
   - `supabase-schema.sql`
   - `supabase-projects-module.sql`
   - `supabase-project-quotation-invoices.sql`
   - `supabase-migrate-legacy-quotations.sql`
   - `supabase-inventory-module.sql`
   - `supabase-inventory-policy-hardening.sql`
   - `supabase-suppliers-purchase-bills.sql`
   - `supabase-walk-in-orders.sql`
   - `supabase-payments-accounts.sql`
3. Open **Authentication → Providers → Email** and keep Email enabled.
4. For controlled testing, turn off public user sign-up after creating the test accounts.
5. Open **Authentication → Users → Add user**. Create the owner's email/password account. Select the option that marks the email as confirmed.
6. Create each tester in the same way. The supplied database trigger gives every newly created user a separate test workspace. Sharing one workspace between staff will be added when the staff-management module is built.
7. Open the project **Connect** dialog or **Settings → API Keys**. Copy:
   - Project URL
   - Publishable key beginning with `sb_publishable_`
8. `config.js` is already connected to **Carpenter Acc App** with its publishable browser key. Never paste a secret key or service-role key into this file.
9. In Supabase, open **Authentication → URL Configuration**. After GitHub Pages is deployed, add the GitHub Pages address as the Site URL and Redirect URL.

## Part B — Deploy the frontend to GitHub Pages

1. Use the public GitHub repository `ahmadecom7337/mughal-interior-accounts`.
2. Upload these files into the repository root:
   - `index.html`
   - `styles.css`
   - `app.js`
   - `config.js`
   - `supabase-schema.sql`
   - `DEPLOYMENT-GUIDE.md`
3. Commit the upload.
4. Open **Settings → Pages**.
5. The included GitHub Actions workflow deploys the `main` branch to GitHub Pages automatically.
6. If GitHub asks for a Pages source once, choose **GitHub Actions**.
7. Open the Pages address shown by GitHub after deployment completes.
8. Sign in with the Supabase test account and test on both a phone and computer.

## Recommended test checklist

- Add and edit a party.
- Search parties by name, phone, and address.
- Create, print, and approve a project quotation.
- Generate an invoice only from an approved project.
- Add a material and assign it to an approved project.
- Add a supplier and post a purchase bill with two material lines.
- Verify the purchase bill increases both material stock quantities.
- Print the purchase bill and choose **Save as PDF**.
- Create a walk-in order and move it from Pending to In Progress, Ready, and Delivered.
- Add a receipt, labour cost, expense, and material to the walk-in order.
- Verify the material assignment reduces stock and appears as an internal order cost.
- Print the walk-in customer order and verify internal costs and profit are excluded.
- Add cash, bank, and mobile-wallet payment accounts.
- Receive a customer payment against an approved project and a walk-in order; verify each balance decreases.
- Pay an unpaid supplier bill and verify its paid and due amounts update.
- Record other business income and an expense.
- Transfer money between two accounts and verify the total business balance does not change.
- Open an account ledger and print a payment record.
- Review project and order profitability, cash flow, receivables, and supplier payables.
- Filter reports by date and relevant business entity, then export CSV and save PDF.
- Verify that unassigned purchases remain inventory and only assigned material appears as a job cost.
- Refresh the page and verify that online data remains available.
- Check tap targets, font sizes, forms, scrolling, and keyboard behaviour on mobile.

Posted payments are immutable accounting records. Correct a mistaken payment with an opposite transaction rather than editing its amount or account.
