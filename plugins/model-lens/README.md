# Model Lens

Focus the model picker: hide models you never use, widen the dropdown.

- Hidden models collapse into one `N hidden — show` row at the picker's bottom.
  Nothing is ever removed: the current selection always renders, and one click
  restores the full list in place.
- New models default visible. Explicit hides only, keyed on `provider/modelId`.
- Picker width is a slider in settings (16–32rem), applied via an injected
  stylesheet owned by the content script (removed on deactivate).
- Fails open everywhere: observer errors, missing catalog, or RPC failure all
  leave the stock picker untouched.

Settings live in Plugins → Model Lens. CLI mirrors everything:

```
bb model-lens list
bb model-lens hide <provider/model>
bb model-lens show <provider/model>
bb model-lens clear
bb model-lens width <rem>
```
