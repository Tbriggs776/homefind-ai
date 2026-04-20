/**
 * homeFinder AI Featured Listings — Carousel JS
 *
 * Minimal vanilla JS. Only loaded when layout="carousel" is rendered.
 * No jQuery, no build step, no dependencies.
 */
( function () {
	'use strict';

	/**
	 * Initialises a single carousel element.
	 *
	 * @param {HTMLElement} carousel The element with [data-hfai-carousel].
	 */
	function initCarousel( carousel ) {
		var track   = carousel.querySelector( '.hfai-carousel-track' );
		var btnPrev = carousel.querySelector( '.hfai-carousel-prev' );
		var btnNext = carousel.querySelector( '.hfai-carousel-next' );

		if ( ! track || ! btnPrev || ! btnNext ) return;

		var cards        = Array.prototype.slice.call( track.children );
		var total        = cards.length;
		var currentIndex = 0;

		/** How many cards fit in the visible area. */
		function visibleCount() {
			var carouselWidth = carousel.offsetWidth;
			if ( carouselWidth < 640 )  return 1;
			if ( carouselWidth < 1024 ) return 2;
			return 3;
		}

		function maxIndex() {
			return Math.max( 0, total - visibleCount() );
		}

		function getCardWidth() {
			if ( ! cards[0] ) return 0;
			// offsetWidth includes padding; add computed gap.
			var style = window.getComputedStyle( track );
			var gap   = parseFloat( style.columnGap || style.gap || '0' );
			return cards[0].offsetWidth + gap;
		}

		function updateTrack() {
			var offset = currentIndex * getCardWidth();
			track.style.transform = 'translateX(-' + offset + 'px)';
			btnPrev.disabled = currentIndex <= 0;
			btnNext.disabled = currentIndex >= maxIndex();
		}

		btnPrev.addEventListener( 'click', function () {
			if ( currentIndex > 0 ) {
				currentIndex--;
				updateTrack();
			}
		} );

		btnNext.addEventListener( 'click', function () {
			if ( currentIndex < maxIndex() ) {
				currentIndex++;
				updateTrack();
			}
		} );

		// Re-calculate on resize (debounced).
		var resizeTimer;
		window.addEventListener( 'resize', function () {
			clearTimeout( resizeTimer );
			resizeTimer = setTimeout( function () {
				// Clamp current index to new maxIndex.
				currentIndex = Math.min( currentIndex, maxIndex() );
				updateTrack();
			}, 150 );
		} );

		// Keyboard navigation when a button inside the carousel has focus.
		carousel.addEventListener( 'keydown', function ( e ) {
			if ( e.key === 'ArrowLeft' || e.key === 'ArrowRight' ) {
				if ( document.activeElement && carousel.contains( document.activeElement ) ) {
					if ( e.key === 'ArrowLeft' && currentIndex > 0 ) {
						currentIndex--;
						updateTrack();
						e.preventDefault();
					} else if ( e.key === 'ArrowRight' && currentIndex < maxIndex() ) {
						currentIndex++;
						updateTrack();
						e.preventDefault();
					}
				}
			}
		} );

		updateTrack();
	}

	/**
	 * Boot: find all carousels on the page and initialise each one.
	 */
	function boot() {
		var carousels = document.querySelectorAll( '[data-hfai-carousel]' );
		for ( var i = 0; i < carousels.length; i++ ) {
			initCarousel( carousels[i] );
		}
	}

	if ( document.readyState === 'loading' ) {
		document.addEventListener( 'DOMContentLoaded', boot );
	} else {
		boot();
	}
}() );
