# Storeforge: walkthrough and pitch script

The narration of the video tutorial, scene by scene, with the points shown on screen. Read it to rehearse your pitch.

## 1. Storeforge

- Full walkthrough and pitch guide
- Built with Next.js, MongoDB Atlas and Vercel

Welcome. This video is the complete guide to your platform, Storeforge. By the end you will know what it is, who uses it, how every screen works, how it keeps stores safe, what has been tested, what is still missing, and exactly how to pitch it to anyone. Take your time, and pause whenever you want.

## 2. What Storeforge is

- One platform that launches online stores for many businesses
- Each store gets its own address, its own data and its own look
- Features are switched on or off, not coded
- English and Urdu, mobile first, built for small businesses

Storeforge is one platform that can launch complete online stores for many different businesses. A restaurant, a fashion shop, a pharmacy, each gets its own web address, its own private database, its own branding, and exactly the features it needs. The key idea is that you do not write new code for each client. You create a store from a template, choose an industry pack, and switch features on or off. That is what makes it fast to launch and cheap to run.

## 3. The public home page

- Where visitors, clients and owners start

This is the public home page. It explains the product, lists the industry packs, and has the entry points. Store owner sign in takes a store owner to their own shop by typing their store name. Admin sign in is only for you, the platform owner. And Visit the demo store opens a live example shop, which is the best thing to show first when you pitch.

## 4. Who uses it

- Super Admin: you, the platform operator
- Store Owner: your client who runs a shop
- Manager, Cashier, Kitchen: the owner's staff
- Customer: the person who buys

There are three layers of people. First, the Super Admin, which is you. You create and govern all the stores. Second, each store owner, your client, who runs one shop. They can invite staff: managers who run the shop, cashiers who process orders, and kitchen or operations staff who only move orders through preparation. Third, the customers who shop on the stores. Every role is enforced on the server for every single request, never just by hiding a button.

## 5. How it is built

- Next.js 16 and React 19, TypeScript, Tailwind
- One codebase serves every store
- MongoDB Atlas: one platform database plus one database per store
- Hosted on Vercel in Mumbai, next to the database
- Payments through an adapter; card data never touches us

Technically, it is one Next.js application, written in TypeScript. One codebase and one deployment serve every store. The data lives in MongoDB Atlas. There is one platform database that holds the store registry, the plans, and the audit log, plus a separate database for each store holding its products, orders and staff. The app runs on Vercel, and I placed it in the Mumbai region, right next to the database, which cut page times to roughly a third of a second. Payments go through an adapter, and card details never touch your servers.

## 6. Why stores can not see each other

- 1. The store comes only from the web address, never from the browser
- 2. Every database call needs a verified tenant context
- 3. Every record is also stamped with its store id
- 4. Automated tests try to break the walls on every release

The most important promise to a client is that nobody else can see their data. Here is how that is guaranteed. First, the store is decided only from the web address, never from anything the browser sends, so a forged header does nothing. Second, every database call must carry a verified tenant context, and the code will not run without it. Third, each record is also stamped with its store id, so even a mistake cannot return another store's data. And fourth, automated tests sign in as one store and try to read, change, delete and search another store's data, on every release. They all must fail safely.

## 7. The feature catalogue

- 145 features, each with prerequisites and a clear state

This is the feature catalogue, the heart of the platform. There are one hundred and forty five features, such as product variants, bundles, kitchen display, discount codes, refunds and the Urdu interface. Each has a default, and some need other features first. For example, required option groups need modifiers. If you try to switch one on without its prerequisite, the system tells you exactly what is missing. Thirty one features are fully working today. The rest are registered and marked coming soon, so nothing silently does nothing.

## 8. Who wins when settings disagree

- 1. Global kill switch  (platform, beats everything)
- 2. Super Admin lock  (owner can not change)
- 3. Super Admin override
- 4. Not in the plan means off
- 5. Owner choice   6. Plan default   7. Industry pack   8. Catalogue default
- Finally: a feature stays off if a prerequisite is off

Settings can come from several places, so there is a strict order. At the top is the global kill switch, which you use in an emergency. Next comes a Super Admin lock, then a Super Admin override. Below those, if a feature is not in the store's plan, it is off. Then the owner's own choice, then the plan default, then the industry pack default, then the catalogue default. Finally, whatever the result, a feature turns off if something it depends on is off. This order is tested, and the same logic is used everywhere.

## 9. Plans and industry packs

- Starter, Growth and Pro, plus eight industry packs

Plans decide which features a client may use and how much they can store. Starter includes one hundred and twenty eight features, one staff seat and a hundred products. Growth has one hundred and forty features, five seats and two thousand products. Pro has all one hundred and forty five, twenty five seats and fifty thousand products. Prices are your business decision. The platform just enforces the limits. On top of plans, there are eight industry packs: restaurant, fashion, grocery, electronics, bookings, digital goods, pharmacy and wholesale. A pack only sets starting defaults and categories. The owner can change anything afterwards.

## 10. Super Admin dashboard

- Your control room

Now the Super Admin area, your control room. The dashboard shows how many stores exist, how many are active or suspended, and how many audit entries have been recorded. The sidebar gives you Stores, Plans, the Audit log, the Kill switch and the feature catalogue.

## 11. Creating a store

- Name, address, industry pack, plan, owner email

This is where you create a store for a client. You enter the store name and a web address. While you type, the system checks live whether the address is free, refuses reserved names like admin, and suggests alternatives. Then you pick an industry pack, a plan, and the owner's email, and click Create. Behind the button runs a careful sequence: it reserves the address, creates the private database, seeds the starter categories, creates the owner invitation, and activates the store. If any step fails, everything is rolled back and you are told exactly which step failed. Nothing half created is ever left behind.

## 12. All stores

- Status, plan and pack at a glance

The Stores page lists every store with its address, plan, pack and status. Click Manage to open one.

## 13. Managing one store

- Plan, status, owner access, support, export, feature rules

Inside a store you can change its plan, and features outside the new plan switch off while all data is kept. You can suspend the store, which shows customers a notice and keeps everything safe, and reactivate it later. You can create a new one time setup link for the owner, valid for one hour. Further down you can sign in as the owner for support. That requires a reason, lasts thirty minutes, shows a red banner, cannot change the owner's password or two step settings, emails the owner, and logs every page you visit. You can also download an export of the store's data, and lock or override any individual feature.

## 14. Emergency kill switch

- Force a feature off everywhere, no deploy

The kill switch is for emergencies. If a payment provider goes down, you can force that one feature off for every store at once, without deploying code. It takes effect within about thirty seconds and beats every lock, override and owner choice. Remove the switch when the problem is over.

## 15. Audit log

- Who did what, and when. Entries can not be edited

Every important action is written to the audit log: creating stores, changing plans, locks, support sessions, refunds, privacy requests and sign ins. You can filter by action and outcome. The application can only add entries, never change or delete them, and secrets are automatically removed before anything is stored.

## 16. Owner sign in and two step security

- Password plus a 6 digit authenticator code

Here is how a store owner gets in. You send them the one time link. They choose their own password, so you never see it. At their store's sign in page they enter email and password, and then a six digit code from an authenticator app. Two step sign in is mandatory for staff. Codes cannot be reused, repeated wrong attempts are rate limited, and changing a password signs out every other device.

## 17. Store owner dashboard

- Orders, sales, low stock, launch checklist

This is what your client sees. A launch checklist guides new owners: accept payments, set up shipping, publish a product, and add contact details. Below it are orders in the last day, open orders, net sales after refunds, products live, recent orders, and a low stock warning. The menu on the left only shows what that person's role is allowed to use.

## 18. Products and stock

- Prices in exact minor units, stock tracking

Owners manage products here: name, description, price, an optional crossed out compare at price, category, image link, stock and published or draft status. Prices are stored as whole numbers of the smallest currency unit, so there are never rounding errors with money. Drafts are invisible to customers. Categories, bulk safe validation, and automatic unique web addresses for each product are included.

## 19. The owner's Features screen

- Switch on what you need. Undo for 24 hours

The Features screen lets owners switch features on and off. If something needs another feature, they are told in plain language and can enable the whole chain with one confirmation. Features locked by you show a lock. Features outside their plan say upgrade to unlock. Every change can be undone for twenty four hours, and switching something off never deletes data.

## 20. Branding and settings

- Brand colour with an automatic readability check

In settings, owners set the store name, tagline, brand colour, logo link and contact email. The colour picker checks readability live. If a colour would make text hard to read, it warns and can fix it automatically, so every store meets accessibility contrast rules. Owners can also set currency, tax, shipping fee and the free shipping threshold.

## 21. Staff and roles

- Invite staff with limited permissions

Owners invite staff by email with a role. The number of seats comes from the plan. Nobody can change their own access, owners cannot be removed by others, and disabling someone signs them out immediately.

## 22. The storefront

- Branded, fast and mobile first

Now the customer's side. This is a live store. The colours, name and categories come from the owner's settings. Customers can search, browse categories, and open products. Pages are fast, and the design adapts to phones.

## 23. Browsing products

- Search, categories, stock badges, sale prices

The shop page shows products with sale prices and stock badges like out of stock or only a few left. Filters live in the web address, so links can be shared, and search is safe against malicious input.

## 24. Product page

- Price, stock, add to cart, structured data

A product page shows the price, availability, description and an add to cart control. It also includes search engine data, so products can appear with prices in search results.

## 25. Cart

- Server-side prices, free shipping progress

The cart always takes prices from the database, never from the browser, so prices cannot be tampered with. It shows shipping, tax, and a progress bar toward free shipping. If an item sells out or is hidden, the cart flags it before checkout.

## 26. Checkout

- One screen, guest friendly, keeps your data on errors

Checkout is a single screen for guests. If something is wrong, the field is named, the message explains how to fix it, and what the customer typed is kept. Customers choose card or cash on delivery, and can enter a discount code. Discounts apply before tax. Every order carries a unique key so double clicks never create two orders.

## 27. Payment

- A hosted payment page. We never see card numbers

For card payments, the customer goes to a hosted payment page. This build uses a test gateway that behaves like a real one: it reports the result to the server with a signed message. The order stays pending until that message arrives, so closing the browser, or faking a redirect, can never mark an order paid. The message is verified with a cryptographic signature, rejected if too old, de duplicated if repeated, and checked against the order amount.

## 28. Order confirmation and tracking

- A secret link, a live timeline

After payment, the customer sees a confirmation with a timeline that updates by itself. Their link contains a secret token, so order numbers alone give nobody access. If payment fails, they can retry on the same order without a second order or a double charge.

## 29. Order management

- Filter, search, and process orders

Back in the store admin, owners see every order, filter by status, and search by number, name or email. Abandoned card orders expire after thirty minutes and automatically return their stock.

## 30. One order

- Status steps, refunds, full history

Inside an order, staff move it through its states: confirmed, processing, ready, fulfilled and completed, or cancel it. Only valid steps are offered, and kitchen staff can only do preparation steps. Refunds can be partial or full, can never exceed what was paid even if two people click at once, and are safe to repeat. Cancelling gives stock back exactly once. Every change is recorded in a history.

## 31. Customer messages

- A reliable outbox with retries

Customer emails go through an outbox. Messages are stored first and then sent, retrying with increasing delays, and failing messages are kept visible. In this version, emails are recorded here instead of being sent. Connecting a real email provider is one of the next steps.

## 32. Urdu and right to left

- The whole layout mirrors for Urdu

The store supports English and Urdu. Switching to Urdu mirrors the entire layout from right to left, translates the interface, and uses suitable fonts. Owners can set the default language.

## 33. Built for phones

- Bottom navigation, big touch targets

On phones, there is a bottom navigation bar, large touch targets, and pages that load quickly. The store can also be installed like an app, because it provides a web app manifest.

## 34. Security and standards

- Strict content security policy with per-request nonce
- Two step sign in, rate limits, session revocation
- No card data in pages, logs or databases
- Signed, de-duplicated payment webhooks
- Accessibility scan clean, privacy export and deletion

Security is built in, not added later. A strict content security policy blocks injected scripts. Staff use two step sign in, attempts are rate limited across servers, and sessions are revoked when passwords change. No card data ever appears in pages, logs or databases. Payment messages are signed and checked. Accessibility scans found no violations on the main pages. And store owners can export or delete a customer's personal data when asked. A full table of standards is in the project's documentation folder.

## 35. How it was tested

- 308 automated tests against a real database
- 121 black-box security and standards checks
- Race tests: 25 buyers, 5 items: exactly 5 orders
- Cross-store attack tests on every page
- npm audit: 0 vulnerabilities

Quality is backed by numbers. Over three hundred automated tests run against a real database. A further one hundred and twenty one black box checks attack a running copy of the site: signed out visitors, other stores' owners, wrong roles, forged cookies, hostile input, and security headers. In one race test, twenty five buyers fight for five items, and exactly five orders succeed. Dependencies have zero known vulnerabilities. Along the way, testing found and fixed real bugs, like broken email links and forms that lost typed text.

## 36. Running it

- Live on Vercel, database on MongoDB Atlas
- Code on GitHub; every push can be deployed
- Emergency tools: kill switch, suspend, support sessions
- Runbooks and a standards table in the docs folder
- Demo store with sample data

To run it day to day: the site is deployed on Vercel, the code is on GitHub, and the database is on MongoDB Atlas. When something breaks, you have the kill switch, store suspension and support sessions. The docs folder holds runbooks for incidents, the standards table, and the decision records. The demo store has sample products, so you can always show a working shop.

## 37. Be honest about what is not done

- Real payment provider: needs your account
- Real email sending: needs a provider
- Backups and a 1,000 store load test: need a paid Atlas tier
- 114 of 145 features are still coming soon
- Self-service signup, custom domains, customer accounts

For a credible pitch, be honest about what is not finished. Payments use a test gateway, so a real provider is needed before taking real money. Emails are recorded, not sent. The database is on a free tier without backups, and the thousand store scale test has not been run. Thirty one of the one hundred and forty five features work, and the rest are planned. Clients cannot yet sign up and buy a plan themselves, and customer accounts and custom domains are not built. Saying this openly makes you more believable, not less.

## 38. Your 60 second pitch

- Problem: small businesses need a store, agencies need many
- Solution: launch a branded store in minutes from templates
- Proof: isolated data, Urdu and English, tested and secure
- Model: monthly plans per store, you set the prices
- Ask: pilot with two real merchants

Here is a pitch you can say in about a minute. Small businesses need an online store, and agencies need to launch many of them without rebuilding each time. Storeforge lets you launch a branded, mobile friendly store in minutes from a template, with its own address and its own private data. It speaks English and Urdu, it is tested and secure, and the features switch on and off, so every business pays only for what it uses. You charge a monthly plan per store. The next step is a pilot with two real merchants, so the industry packs get real content.

## 39. Likely questions

- Why not Shopify? Local language, white label, you own the data
- Is my data safe? Separate database per store, tested walls
- What if it breaks? Kill switch, suspend, audit trail
- Can it grow? Designed for 1,000 stores, needs a paid tier to prove
- What is missing? Real payments and email, next steps

Expect these questions. Why not Shopify? Because you control the platform, can white label it, support Urdu properly, and own the data and the pricing. Is my data safe? Each store has a separate database, and tests attack those walls. What if something breaks? You have a kill switch, suspension, and a full audit trail. Can it grow? It was designed for a thousand stores, though proving that needs a paid database tier. And what is missing? Real payments and email, which are the clear next steps.

## 40. Five minute demo script

- 1. Home page, then Visit the demo store
- 2. Add a product to the cart and pay with the test gateway
- 3. Switch to Urdu to show right to left
- 4. Admin: orders, refund, features and undo
- 5. Super Admin: create a store, kill switch, audit log

When you demo, keep it to five minutes. Start on the home page and open the demo store. Add a product to the cart and pay with the test gateway. Switch to Urdu to show the right to left layout. Then show the admin, where you process the order, issue a refund and use the features screen with undo. Finish in the Super Admin area by creating a store, showing the kill switch, and the audit log. That tells the whole story.

## 41. You are ready

- Live: ecommerce-webapp-sable.vercel.app
- Demo store: /s/demo
- Docs: standards, runbooks and decisions in the project

That is Storeforge, from the first click to the last safeguard. You now know what it is, how it works, how it is protected, and how to talk about it. The live site and the demo store are ready, and the documentation is in the project. Good luck with your pitch.
