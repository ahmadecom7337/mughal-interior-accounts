# Mughal Interior Accounts — Module 1 deployment

This folder is the complete GitHub Pages frontend for Parties and Contract Quotations.

## Part A — Create the Supabase backend

1. Open the existing Supabase project **Carpenter Acc App**.
2. Open **SQL Editor**, choose **New query**, paste the complete contents of `supabase-schema.sql`, and press **Run**.
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
- Create a quotation with material.
- Create a labour-only quotation.
- Create a quotation showing both prices.
- Save a draft, mark it sent, and approve it.
- Print the quotation and choose **Save as PDF**.
- Refresh the page and verify that online data remains available.
- Check tap targets, font sizes, forms, scrolling, and keyboard behaviour on mobile.

Quotations in this module have no accounting impact. Invoice conversion will be added only after this workflow is approved.
