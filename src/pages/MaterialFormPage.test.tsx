import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MaterialFormPage } from "@/components/MaterialFormPage";

describe("MaterialFormPage", () => {
  it("shows the new-material defaults before the user types anything", () => {
    render(<MaterialFormPage editing={null} onDone={() => undefined} />);

    expect(screen.getByPlaceholderText("0.00")).toHaveValue("0");
    expect(screen.getByPlaceholderText("0")).toHaveValue("0");
  });

  it("binds the typed price to the saved value", async () => {
    const user = userEvent.setup();
    render(<MaterialFormPage editing={null} onDone={() => undefined} />);

    const price = screen.getByPlaceholderText("0.00");
    await user.clear(price);
    await user.type(price, "25");

    expect(price).toHaveValue("25");
  });
});
