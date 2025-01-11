describe("Ledger Service", () => {
	it("should create a ledger", async () => {
		const ledger = await ledgerService.createLedger(org.id, {
			name: "test",
		});
		expect(ledger.id).toBeDefined();
		expect(ledger.name).toEqual("test");
	});
});
