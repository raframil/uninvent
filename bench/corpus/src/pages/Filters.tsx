const plans = ["Free", "Pro", "Team"];

export function Filters() {
  return (
    <label>
      Plan
      <select defaultValue="Pro">
        {plans.map((plan) => (
          <option key={plan}>{plan}</option>
        ))}
      </select>
    </label>
  );
}
