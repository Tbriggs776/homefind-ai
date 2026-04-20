/**
 * homeFinder AI Featured Listings — Gutenberg block editor registration.
 *
 * No build step. Uses wp.blocks, wp.element, wp.components, wp.blockEditor,
 * and wp.serverSideRender — all provided by WordPress core at runtime.
 *
 * This file is loaded ONLY in the block editor (wp-admin).
 */
( function ( blocks, element, components, blockEditor, serverSideRender ) {
	'use strict';

	var el              = element.createElement;
	var ServerSideRender = serverSideRender;
	var InspectorControls = blockEditor.InspectorControls;
	var PanelBody       = components.PanelBody;
	var RangeControl    = components.RangeControl;
	var SelectControl   = components.SelectControl;

	blocks.registerBlockType( 'homefinder/featured-listings', {
		edit: function ( props ) {
			var attributes = props.attributes;
			var setAttributes = props.setAttributes;

			return [
				el(
					InspectorControls,
					{ key: 'inspector' },
					el(
						PanelBody,
						{
							title: 'Display Settings',
							initialOpen: true
						},
						el( RangeControl, {
							label: 'Number of Cards',
							value: attributes.limit,
							onChange: function ( val ) { setAttributes( { limit: val } ); },
							min: 1,
							max: 24,
							step: 1
						} ),
						el( SelectControl, {
							label: 'Layout',
							value: attributes.layout,
							options: [
								{ label: 'Grid',     value: 'grid'     },
								{ label: 'Carousel', value: 'carousel' },
								{ label: 'List',     value: 'list'     }
							],
							onChange: function ( val ) { setAttributes( { layout: val } ); }
						} ),
						el( RangeControl, {
							label: 'Grid Columns',
							value: attributes.columns,
							onChange: function ( val ) { setAttributes( { columns: val } ); },
							min: 1,
							max: 4,
							step: 1
						} )
					)
				),
				el(
					ServerSideRender,
					{
						key: 'renderer',
						block: 'homefinder/featured-listings',
						attributes: attributes
					}
				)
			];
		},

		// No save function needed — PHP render_callback handles output.
		save: function () { return null; }
	} );

} )(
	window.wp.blocks,
	window.wp.element,
	window.wp.components,
	window.wp.blockEditor,
	window.wp.serverSideRender
);
