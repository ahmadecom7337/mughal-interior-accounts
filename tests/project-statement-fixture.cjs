// Synthetic records only. Never connects to a database.
module.exports = {
  business: {name: 'Mughal Interior'},
  parties: [{id: 'customer-1', name: 'Sample Customer', phone: '', address: 'Sample address'}],
  projects: [{id: 'project-1', name: 'Sample woodwork project', project_number: 'PRJ-0001', party_id: 'customer-1', status: 'Approved', closed: true, quote_date: '2026-01-01', original_contract_amount: 100000, location: 'Sample location'}],
  invoices: [{id: 'invoice-1', project_id: 'project-1', invoice_number: 'INV-0001', invoice_date: '2026-01-05'}],
  entries: [
    {id: 'scope-1', project_id: 'project-1', entry_type: 'scope_increase', entry_date: '2026-02-05', amount: 10000, description: 'Additional cabinets'},
    {id: 'scope-2', project_id: 'project-1', entry_type: 'scope_decrease', entry_date: '2026-02-08', amount: 5000, description: 'Removed shelf'},
    {id: 'mirror', project_id: 'project-1', entry_type: 'receipt', entry_date: '2026-01-10', amount: 20000}
  ],
  materialMovements: [],
  materials: [],
  labourAssignments: [],
  suppliers: [],
  purchaseBills: [],
  payments: [
    {id: 'receipt-1', project_id: 'project-1', payment_type: 'customer_receipt', payment_date: '2026-01-10', amount: 20000, payment_number: 'RCP-0001', description: 'First payment'},
    {id: 'receipt-2', project_id: 'project-1', payment_type: 'customer_receipt', payment_date: '2026-02-10', amount: 40000, payment_number: 'RCP-0002', description: 'Second payment'},
    {id: 'receipt-3', project_id: 'project-1', payment_type: 'customer_receipt', payment_date: '2026-03-01', amount: 50000, payment_number: 'RCP-0003', description: 'Final payment'},
    {id: 'other-receipt', project_id: 'another-project', payment_type: 'customer_receipt', payment_date: '2026-02-10', amount: 999999},
    {id: 'internal', project_id: 'project-1', payment_type: 'expense', payment_date: '2026-02-10', amount: 333, description: 'Private internal expense'}
  ]
};
